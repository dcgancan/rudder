"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";

import { redirect } from "@/i18n/navigation";
import { orchestrator } from "@/lib/orchestrator";
import { latestRulesetId } from "@/lib/strategies";

/**
 * Bot eylemleri.
 *
 * Hepsi FORM ACTION olarak kullanılıyor, tıklama işleyicisi olarak değil:
 * hidrasyon tamamlanmadan basılan bir düğme aksi halde hiçbir şey yapmaz.
 * Hepsi `redirect()` ile bitiyor — POST → yönlendirme → GET. Yönlendirme
 * olmazsa tarayıcının son geçmiş kaydı bir POST olarak kalıyor ve sayfanın her
 * tazelenişi eylemi yeniden çalıştırıyor; backtest tarafında bu ölçüldü, tek
 * tıklamayla arka arkaya yedi iş başladı.
 */

export async function createBot(form: FormData): Promise<void> {
  const slug = String(form.get("slug") ?? "");
  const name = String(form.get("name") ?? "").trim();

  const rulesetId = latestRulesetId(slug);
  if (!rulesetId) throw new Error(`no such strategy: ${slug}`);

  const id = orchestrator().create({ rulesetId, name });

  revalidatePath("/", "layout");
  redirect({ href: `/bots/${id}`, locale: await getLocale() });
}

export async function startBot(form: FormData): Promise<void> {
  await orchestrator().start(botIdOf(form));
  await backToBot(form);
}

export async function stopBot(form: FormData): Promise<void> {
  await orchestrator().stop(botIdOf(form));
  await backToBot(form);
}

/**
 * Container'ı ve bot dizinini kaldırır, satırı soft-delete eder.
 *
 * GERİ ALINAMAZ. Arayüz bu yüzden iki adımlı soruyor. Kapanmış işlem geçmişi
 * veritabanında kalır — stratejileri karşılaştırabilmenin tek yolu bu.
 */
export async function removeBot(form: FormData): Promise<void> {
  await orchestrator().remove(botIdOf(form));

  revalidatePath("/", "layout");
  redirect({ href: "/bots", locale: await getLocale() });
}

/**
 * Açık bir pozisyonu piyasa emriyle kapatır.
 *
 * Emir tipi motorda `market` olarak sabitlenmiş: "şimdi kapat" diyen birine
 * asılı kalabilecek bir limit emir vermek, olmayan bir düğmeden kötüdür.
 */
export async function closePosition(form: FormData): Promise<void> {
  const botId = botIdOf(form);
  const raw = String(form.get("tradeId") ?? "");
  const tradeId = raw === "all" ? "all" : Number(raw);

  if (tradeId !== "all" && !Number.isInteger(tradeId)) {
    throw new Error(`not a trade id: ${raw}`);
  }

  const client = await orchestrator().client(botId);
  await client.forceExit(tradeId);

  await backToBot(form);
}

function botIdOf(form: FormData): string {
  const id = String(form.get("botId") ?? "");
  if (!id) throw new Error("no bot id in the form");
  return id;
}

async function backToBot(form: FormData): Promise<void> {
  revalidatePath("/", "layout");
  redirect({ href: `/bots/${botIdOf(form)}`, locale: await getLocale() });
}
