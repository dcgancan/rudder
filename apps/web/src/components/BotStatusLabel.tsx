import { getTranslations } from "next-intl/server";

import type { BotStatus } from "@/lib/bots";

/**
 * Durum rozeti.
 *
 * Ham enum (`running`, `starting`, …) doğrudan çeviri anahtarı; kullanıcıya
 * asla İngilizce sabiti olarak gösterilmez.
 *
 * Yalnızca `error` renkli. Çalışıyor olmak kutlanacak bir şey değil, sadece bir
 * durum — kâr için renk kullanmama kuralının aynısı.
 */
export async function BotStatusLabel({ status }: { status: BotStatus }) {
  const t = await getTranslations("botStatus");

  return (
    <span className={`label ${status === "error" ? "text-alert" : ""}`}>
      {status === "running" || status === "starting" ? (
        <span aria-hidden className="text-depth mr-1.5">
          ●
        </span>
      ) : null}
      {t(status)}
    </span>
  );
}
