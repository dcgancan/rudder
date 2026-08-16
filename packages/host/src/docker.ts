/**
 * Docker'a ince bir sarmalayıcı.
 *
 * HTTP API yerine CLI kullanılıyor: bağımlılık yok, çıktısı okunabilir,
 * kullanıcının zaten bildiği arayüz, ve Docker Desktop / Colima / Podman
 * arasında taşınabilir. Bu ölçekte (bir makinede birkaç düzine container)
 * süreç başlatma maliyeti önemsiz.
 *
 * Sırlar KOMUT SATIRINA yazılmaz. `docker run -e KEY=VALUE` değeri argv'ye
 * koyar ve aynı makinedeki başka kullanıcılar bunu `ps` ile görebilir. Bunun
 * yerine değersiz `-e KEY` biçimi kullanılır; Docker CLI değeri kendi
 * ortamından alır, biz de onu alt sürecin ortamına koyarız.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Freqtrade bir backtest sırasında megabaytlarca log üretebiliyor ve Node'un
 * 1 MB'lık varsayılanı aşıldığında süreç ÖLDÜRÜLÜR — yani sınırı çalışan bir
 * backtest'i keserek fark ederiz.
 */
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

export type Mount = {
  host: string;
  container: string;
  readonly?: boolean;
};

export type PortPublish = {
  /** Varsayılan 127.0.0.1 — container API'leri makine dışına açılmamalı. */
  hostIp?: string;
  hostPort: number;
  containerPort: number;
};

export type RunOptions = {
  name: string;
  image: string;
  command: string[];
  mounts?: Mount[];
  /** Değerler argv'ye değil, alt sürecin ortamına konur. */
  env?: Record<string, string>;
  publish?: PortPublish[];
  labels?: Record<string, string>;
  /** Varsayılan "unless-stopped": container makine yeniden başlasa da geri gelsin. */
  restart?: "no" | "unless-stopped" | "on-failure";
};

/** Bitene kadar çalışan tek seferlik iş. Uzun ömürlü servis değil. */
export type RunOnceOptions = {
  name: string;
  image: string;
  command: string[];
  mounts?: Mount[];
  env?: Record<string, string>;
  labels?: Record<string, string>;
  /** Aşılırsa container kaldırılır ve hata fırlatılır. Varsayılan 30 dakika. */
  timeoutMs?: number;
};

export type ContainerState = {
  id: string;
  running: boolean;
  /** Docker'ın kendi durumu: created · running · restarting · exited · dead. */
  status: string;
  exitCode: number | null;
  /**
   * Docker'ın yeniden başlatma politikasını kaç kez uyguladığı.
   *
   * Çöküp duran bir container'ı anlamanın TEK güvenilir yolu bu. Ölçüldü:
   * `--restart unless-stopped` ile saniyede bir çöken bir container her
   * örneklemede `running=true` diyor ve `exitCode` örnekleme anına göre 0 ya
   * da 1 dönüyor. Bu sayaç ise yalnızca artıyor.
   */
  restartCount: number;
  startedAt: string | null;
  finishedAt: string | null;
};

export class DockerError extends Error {
  /**
   * Container'ın o ana kadar ürettiği çıktı.
   *
   * Hata mesajının kendisi kısaltılmış olabilir; teşhis için tam metin lazım
   * ve tek kaynağı ölen sürecin akışları.
   */
  output: string;

  constructor(message: string, output = "") {
    super(message);
    this.name = "DockerError";
    this.output = output;
  }
}

export async function isDockerAvailable(): Promise<boolean> {
  try {
    await run("docker", ["version", "--format", "{{.Server.Version}}"]);
    return true;
  } catch {
    return false;
  }
}

export async function runContainer(options: RunOptions): Promise<string> {
  const {
    name,
    image,
    command,
    mounts = [],
    env = {},
    publish = [],
    labels = {},
    restart = "unless-stopped",
  } = options;

  const args = ["run", "--detach", "--name", name, "--restart", restart];

  for (const mount of mounts) args.push("--volume", volumeArg(mount));

  for (const port of publish) {
    args.push("--publish", `${port.hostIp ?? "127.0.0.1"}:${port.hostPort}:${port.containerPort}`);
  }

  // Yalnızca anahtar adı; değer alt sürecin ortamından okunur.
  for (const key of Object.keys(env)) args.push("--env", key);

  for (const [key, value] of Object.entries(labels)) args.push("--label", `${key}=${value}`);

  args.push(image, ...command);

  try {
    const { stdout } = await run("docker", args, { env: { ...process.env, ...env } });
    return stdout.trim();
  } catch (error) {
    throw new DockerError(`failed to start container ${name}: ${describeError(error)}`);
  }
}

/**
 * Container'ı ön planda çalıştırır ve çıktısını döndürür.
 *
 * `--rm` yalnızca container KENDİ durduğunda temizler; Docker CLI'ını öldürmek
 * container'ı öldürmez. Bu yüzden zaman aşımında ve hatada container açıkça
 * kaldırılır — yoksa arkada çalışmaya devam eder ve adı bir sonraki denemeyi
 * bloke eder.
 */
export async function runOnce(options: RunOnceOptions): Promise<string> {
  const {
    name,
    image,
    command,
    mounts = [],
    env = {},
    labels = {},
    timeoutMs = 30 * 60_000,
  } = options;

  // Önceki bir çalıştırmadan kalan aynı adlı container `docker run`'ı isim
  // çakışmasıyla düşürür.
  await removeContainer(name);

  const args = ["run", "--rm", "--name", name];

  for (const mount of mounts) args.push("--volume", volumeArg(mount));
  for (const key of Object.keys(env)) args.push("--env", key);
  for (const [key, value] of Object.entries(labels)) args.push("--label", `${key}=${value}`);

  args.push(image, ...command);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const { stdout, stderr } = await run("docker", args, {
      env: { ...process.env, ...env },
      signal: controller.signal,
      maxBuffer: MAX_OUTPUT_BYTES,
    });
    return joinStreams(stderr, stdout);
  } catch (error) {
    await removeContainer(name);

    const output = errorOutput(error);
    if (controller.signal.aborted) {
      throw new DockerError(`container ${name} exceeded ${timeoutMs}ms and was removed`, output);
    }
    throw new DockerError(`container ${name} failed: ${describeError(error)}`, output);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `docker inspect --format` çıktısının alan sırası.
 *
 * Sıra bu dizede ve `parseInspect`'te aynı olmak zorunda; kayan bir alan
 * sessizce yanlış değeri okur. Ayrıştırma ayrı bir fonksiyon olduğu için
 * Docker olmadan test edilebiliyor.
 */
const INSPECT_FORMAT = [
  "{{.Id}}",
  "{{.State.Running}}",
  "{{.State.Status}}",
  "{{.State.ExitCode}}",
  "{{.RestartCount}}",
  "{{.State.StartedAt}}",
  "{{.State.FinishedAt}}",
].join("\t");

export function parseInspect(line: string): ContainerState {
  const [id, running, status, exitCode, restartCount, startedAt, finishedAt] = line
    .trim()
    .split("\t");

  return {
    id: id ?? "",
    running: running === "true",
    status: status ?? "unknown",
    exitCode: exitCode === undefined ? null : Number(exitCode),
    // Alan eksikse 0 saymak, "hiç yeniden başlamadı" demek — yokluğu bir
    // yeniden başlatma gibi okumaktan iyi.
    restartCount: restartCount === undefined ? 0 : Number(restartCount),
    startedAt: startedAt ?? null,
    finishedAt: finishedAt ?? null,
  };
}

export async function inspectContainer(name: string): Promise<ContainerState | null> {
  try {
    const { stdout } = await run("docker", ["inspect", "--format", INSPECT_FORMAT, name]);
    return parseInspect(stdout);
  } catch {
    // Olmayan container için docker sıfırdan farklı çıkar — bu bir hata değil.
    return null;
  }
}

export async function stopContainer(name: string, timeoutSeconds = 30): Promise<void> {
  try {
    await run("docker", ["stop", "--time", String(timeoutSeconds), name]);
  } catch (error) {
    if (await inspectContainer(name)) {
      throw new DockerError(`failed to stop container ${name}: ${describeError(error)}`);
    }
    // Container zaten yok — istenen sonuç bu.
  }
}

export async function removeContainer(name: string): Promise<void> {
  try {
    await run("docker", ["rm", "--force", name]);
  } catch (error) {
    if (await inspectContainer(name)) {
      throw new DockerError(`failed to remove container ${name}: ${describeError(error)}`);
    }
  }
}

export async function containerLogs(name: string, tail = 50): Promise<string> {
  try {
    const { stdout, stderr } = await run("docker", ["logs", "--tail", String(tail), name]);
    // Freqtrade stderr'e loglar; ikisini de döndürüyoruz.
    return joinStreams(stderr, stdout);
  } catch {
    return "";
  }
}

/** Bir etikete sahip container adlarını listeler — yetim container bulmak için. */
export async function listContainers(label: string): Promise<string[]> {
  try {
    const { stdout } = await run("docker", [
      "ps", "--all", "--filter", `label=${label}`, "--format", "{{.Names}}",
    ]);
    return stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export function volumeArg(mount: Mount): string {
  return `${mount.host}:${mount.container}${mount.readonly ? ":ro" : ""}`;
}

function joinStreams(stderr: string, stdout: string): string {
  return [stderr, stdout].filter(Boolean).join("\n").trim();
}

/** Ölen sürecin akışları. Kesilmiş çıktı da hiç yoktan iyidir. */
function errorOutput(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const { stdout, stderr } = error as { stdout?: unknown; stderr?: unknown };
  return joinStreams(stderr ? String(stderr) : "", stdout ? String(stdout) : "");
}

function describeError(error: unknown): string {
  if (error && typeof error === "object" && "stderr" in error) {
    const stderr = String((error as { stderr: unknown }).stderr).trim();
    if (stderr) return stderr;
  }
  return error instanceof Error ? error.message : String(error);
}
