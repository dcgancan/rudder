/**
 * Küçük bir ZIP okuyucu.
 *
 * Freqtrade backtest sonucunu zip'liyor ve `--export-filename` artık
 * kullanımdan kalktığı için bunu kapatmanın bir yolu yok. Node'da yerleşik
 * zip desteği de yok.
 *
 * Bir bağımlılık ya da harici bir `unzip` ikilisi getirmek yerine burada
 * ihtiyacımız olan kadarı yazılı: merkezi dizini yürü, istenen girdiyi bul,
 * `zlib` ile aç. Okuduğumuz dosyalar kendi ürettiğimiz container'dan
 * geliyor — genel amaçlı bir arşiv okuyucusu değil, dar bir okuyucu yeter.
 */

import { inflateRawSync } from "node:zlib";

const EOCD_SIGNATURE = 0x0605_4b50;
const CENTRAL_SIGNATURE = 0x0201_4b50;
const LOCAL_SIGNATURE = 0x0403_4b50;

const EOCD_MIN_SIZE = 22;
/** EOCD'yi sona iten en uzun arşiv yorumu 65535 bayt olabilir. */
const EOCD_MAX_SCAN = 65_535 + EOCD_MIN_SIZE;

const STORED = 0;
const DEFLATED = 8;

/** Zip64 işareti. Bu boyuttaki bir sonuç bizim üretimimizde mümkün değil. */
const ZIP64_MARKER = 0xffff_ffff;

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipError";
  }
}

type CentralEntry = {
  name: string;
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
};

export function zipEntryNames(archive: Buffer): string[] {
  return readCentralDirectory(archive).map((entry) => entry.name);
}

/**
 * İlk eşleşen girdinin içeriğini döndürür.
 *
 * Eşleşme adın tamamı üzerinden yapılır; çağıran ne aradığını bilir.
 */
export function readZipEntry(archive: Buffer, matches: (name: string) => boolean): Buffer {
  const entries = readCentralDirectory(archive);
  const entry = entries.find((candidate) => matches(candidate.name));

  if (!entry) {
    throw new ZipError(`no matching entry in archive (has: ${entries.map((e) => e.name).join(", ")})`);
  }

  return readEntryData(archive, entry);
}

function readCentralDirectory(archive: Buffer): CentralEntry[] {
  const eocd = findEocd(archive);
  const count = archive.readUInt16LE(eocd + 10);
  let offset = archive.readUInt32LE(eocd + 16);

  if (offset === ZIP64_MARKER) throw new ZipError("zip64 archives are not supported");

  const entries: CentralEntry[] = [];

  for (let index = 0; index < count; index++) {
    if (archive.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new ZipError(`corrupt central directory at byte ${offset}`);
    }

    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);

    entries.push({
      name: archive.toString("utf8", offset + 46, offset + 46 + nameLength),
      method: archive.readUInt16LE(offset + 10),
      compressedSize: archive.readUInt32LE(offset + 20),
      localHeaderOffset: archive.readUInt32LE(offset + 42),
    });

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function readEntryData(archive: Buffer, entry: CentralEntry): Buffer {
  const header = entry.localHeaderOffset;
  if (archive.readUInt32LE(header) !== LOCAL_SIGNATURE) {
    throw new ZipError(`corrupt local header for ${entry.name}`);
  }

  // Yerel başlıktaki uzunluklar merkezi dizindekilerden FARKLI olabilir;
  // veri konumu için yerel olanlar geçerlidir.
  const nameLength = archive.readUInt16LE(header + 26);
  const extraLength = archive.readUInt16LE(header + 28);

  const start = header + 30 + nameLength + extraLength;
  const data = archive.subarray(start, start + entry.compressedSize);

  if (entry.method === STORED) return Buffer.from(data);
  if (entry.method === DEFLATED) return inflateRawSync(data);

  throw new ZipError(`unsupported compression method ${entry.method} for ${entry.name}`);
}

/** Sondan geriye tarar: EOCD arşivin en sonundadır, yalnızca yorum arkasında olabilir. */
function findEocd(archive: Buffer): number {
  if (archive.length < EOCD_MIN_SIZE) throw new ZipError("file is too short to be a zip archive");

  const limit = Math.max(0, archive.length - EOCD_MAX_SCAN);

  for (let offset = archive.length - EOCD_MIN_SIZE; offset >= limit; offset--) {
    if (archive.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }

  throw new ZipError("not a zip archive: no end-of-central-directory record");
}
