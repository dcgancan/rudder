/*
 * Rudder — readable trading strategies
 * Copyright (C) 2026 Doğancan Öztürk
 *
 * This program is free software: you can redistribute it and/or modify it under
 * the terms of the GNU Affero General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option) any
 * later version. It is distributed WITHOUT ANY WARRANTY; without even the
 * implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See <https://www.gnu.org/licenses/> for the full license.
 */

/**
 * Bir container'ın gözlenen halini bot durumuna çevirir.
 *
 * SAF. Docker'a da veritabanına da dokunmaz, çünkü buradaki kuralların yanlış
 * olması ekranda görünen her durumu yanlış yapıyor ve bunu container
 * başlatmadan doğrulayabilmek gerekiyor. Kuyruğun `BacktestExecutor` dar
 * arayüzüyle aynı gerekçe.
 */

import type { BotEventKind, BotRow } from "@rudder/db";
import type { ContainerState } from "@rudder/host";

export type BotStatus = BotRow["status"];

/**
 * Bu değerin üstündeki çıkış kodları "sonlandırıldı" demek, "çöktü" değil.
 *
 * POSIX geleneği 128 + sinyal numarası. Ölçülen: `docker stop` sonrası
 * Freqtrade container'ı **130** ile çıkıyor (kendi kesme yolu), makinenin
 * kapanması 143 (SIGTERM) ya da 137 (SIGKILL) veriyor. Bunları çökme saymak,
 * kullanıcının kendi durdurduğu botu "hata" olarak göstermek demek — arayüzde
 * tam olarak öyle oldu.
 *
 * Kabul edilen bedel: bellek yetersizliğinden öldürülen bir bot (137) da
 * "durdu" görünür. Yanlış yön olarak bu, en sık yaşanan yolu yanlış
 * işaretlemekten iyi; gerçek çökmeler (Python hatası 1, hatalı argüman 2)
 * hâlâ hata olarak görünüyor.
 */
export const SIGNAL_EXIT_FLOOR = 128;

/**
 * Docker'ın yeniden başlatma politikasını uygularken beklediği ara.
 *
 * ÖLÇÜLDÜ — `--restart unless-stopped` ile saniyede bir çöken bir container,
 * iki saniyede bir örneklendiğinde:
 *
 *     running=true  status=running     exit=0  restarts=1
 *     running=true  status=running     exit=0  restarts=3
 *     running=true  status=running     exit=0  restarts=4
 *     running=true  status=restarting  exit=1  restarts=5
 *     running=true  status=restarting  exit=1  restarts=6
 *
 * İki sonuç buradaki kuralları belirliyor:
 *
 *  1. `running` HER örneklemede true. Yalnızca ona bakan bir sınıflandırıcı
 *     çöküp duran botu "çalışıyor" sayar; API cevap vermediği için de
 *     "açılıyor"da takılır ve orada sonsuza kadar kalır. Arayüzde tam olarak
 *     bu görüldü: çöken bot "Açılıyor" yazıyordu, "Hata" değil.
 *  2. `exitCode` örnekleme anına göre 0 ya da 1. Tek başına güvenilmez.
 *
 * Bu yüzden `restarting` durumu ÇÖKME sayılıyor. Sağlıklı bir açılışta bu
 * değer hiç görülmüyor — container `created`'dan doğrudan `running`'e geçiyor.
 */
const RESTARTING = "restarting";

export type Observation = {
  /** `inspectContainer` sonucu; container yoksa null. */
  state: ContainerState | null;
  /** Bot API'si cevap verdi mi. Container ayakta değilse sorulmaz. */
  reachable: boolean;
};

export function classify({ state, reachable }: Observation): BotStatus {
  if (!state) return "stopped";

  // `running` true iken bile geçerli — bkz. yukarıdaki ölçüm.
  if (state.status === RESTARTING) return "error";

  if (!state.running) {
    const crashed =
      state.exitCode !== null && state.exitCode !== 0 && state.exitCode < SIGNAL_EXIT_FLOOR;
    return crashed ? "error" : "stopped";
  }

  // Container ayakta ama API henüz cevap vermiyor — hâlâ açılıyor.
  return reachable ? "running" : "starting";
}

// ---------------------------------------------------------------------------
// Olaylar
// ---------------------------------------------------------------------------

/** Bir botun iki yoklama arasında karşılaştırılan hali. */
export type Snapshot = {
  status: BotStatus;
  /**
   * Botun en son SAĞLIKLI görüldüğü andaki Docker yeniden başlatma sayacı.
   *
   * Her yoklamada değil, yalnızca bot `running` iken ilerletilir — ve bu bir
   * ayrıntı değil, olay kaydının okunabilir kalmasının şartı. Ölçüldü: gerçek
   * bir crash loop'ta sayaç saniyede bir büyüyor, ve her yoklamada
   * saklansaydı tek bir çökme için art arda "kendiliğinden yeniden başladı"
   * satırları yazılırdı. Cevap vermeyen bir bot için o cümle zaten yanlış.
   *
   * Sağlıklı anı taban almak, sayacı "en son çalışırken buradaydı" haline
   * getiriyor; toparlanan bot tek bir satırla kayda geçiyor.
   */
  restartCount: number;
};

/**
 * İki yoklama arasında kaydedilmeye değer ne oldu.
 *
 * SAF, ve bilerek cimri: her yoklamada değil yalnızca GEÇİŞTE olay üretir.
 * Aksi halde çöküp duran bir bot on beş saniyede bir satır yazardı ve kayıt
 * okunamaz hale gelirdi.
 *
 * Kullanıcının kendi istediği şeyler olay değildir. Botu durdurmak bir olay
 * üretmez; `stopped` yalnızca satır botun AYAKTA olmasını beklerken container
 * gittiyse yazılır. Niyetin kaydı satırın kendisinde: `stop()` önce
 * `stopping` yazıyor.
 *
 * `latest` — bu bot için kaydedilmiş SON olay — üçüncü girdi olmak zorunda,
 * ve bunu ölçüm öğretti. İki yoklamayı karşılaştırmak yetmiyor: çöküp duran
 * bir botun durumu arada bir an `starting` görünüyor (Docker container'ı yeni
 * kaldırmışken örneklenirse), ve yalnızca bir önceki yoklamaya bakan bir kural
 * bunu "çökme bitti, yeni bir çökme başladı" diye okuyor. Gerçek koşuda tek
 * bir crash loop önce üç, sonra iki satır yazdı; doğrusu bir.
 *
 * Bir "epizot" son kaydedilen olayla tanımlanıyor: bot düştü olarak yazıldıysa,
 * tekrar çalışana kadar düşmüş sayılır.
 */
export function eventsFor(
  previous: Snapshot,
  next: Snapshot,
  latest: BotEventKind | null,
): BotEventKind[] {
  /** Botun düştüğünü söyleyen olaylar. Bir epizot bunlarla açılır. */
  const down = latest === "failed" || latest === "stopped";

  if (next.status === "error") {
    // Aynı çökme ikinci kez yazılmaz. Docker onu geri getirmeye devam ettiği
    // için bu koşul olmadan kayıt saniyeler içinde okunmaz hale gelir.
    return latest === "failed" ? [] : ["failed"];
  }

  if (next.status === "stopped") {
    const expectedUp = previous.status === "running" || previous.status === "starting";
    return expectedUp && latest !== "stopped" ? ["stopped"] : [];
  }

  if (next.status === "running") {
    // Açık bir epizot varsa kapanışı budur — arada `starting` görülmüş olsa da.
    if (down) return ["recovered"];

    // Sayacın büyümesi, Docker'ın botu kimse istemeden geri getirdiği demek.
    // AZALMASI yeni bir container demek (`start()` sayacı sıfırlar), olay değil.
    if (next.restartCount > previous.restartCount) return ["restarted"];
  }

  // `starting` hiçbir zaman olay değildir: cevap vermeyen bir bot henüz ne
  // düşmüş ne toparlanmıştır, ve bir sonraki yoklama hangisi olduğunu söyler.
  return [];
}
