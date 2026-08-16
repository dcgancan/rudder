"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";

import { isBacktestPeriod } from "@rudder/backtest";

import { redirect } from "@/i18n/navigation";
import { backtestQueue } from "@/lib/queue";
import { latestRulesetId } from "@/lib/strategies";

/**
 * Bir backtest'i sıraya koyar.
 *
 * FORM ACTION olarak kullanılıyor, tıklama işleyicisi olarak değil: sayfa
 * hidrasyonu tamamlanmadan basılan bir düğme aksi halde formu düz GET olarak
 * gönderir ve hiçbir şey olmaz. Bu haliyle JavaScript hiç çalışmasa bile test
 * başlar; istemci tarafı yalnızca sayfayı kendi kendine tazelemeye yarıyor.
 *
 * Kural seti id'si istemciden GELMİYOR: slug sunucuda en güncel sürüme
 * çözülüyor. Aksi halde arayüz, hangi sürümün ölçüleceğine karar veren taraf
 * olurdu — o karar kataloğun kendisinde.
 */
export async function startBacktest(form: FormData): Promise<void> {
  const slug = String(form.get("slug") ?? "");
  const months = Number(form.get("months"));

  if (!isBacktestPeriod(months)) throw new Error(`unsupported backtest period: ${months}`);

  const rulesetId = latestRulesetId(slug);
  if (!rulesetId) throw new Error(`no such strategy: ${slug}`);

  backtestQueue().enqueue({ rulesetId, months });

  // Katalog kartındaki eğri de bu satıra bakıyor.
  revalidatePath("/", "layout");

  // POST → yönlendirme → GET. Yönlendirme olmadan tarayıcının son geçmiş
  // kaydı bir POST olarak kalıyor ve sayfanın her tazelenişi formu yeniden
  // gönderiyor: ölçüldü, tek tıklamayla arka arkaya yedi backtest başladı.
  redirect({ href: `/strategies/${slug}`, locale: await getLocale() });
}
