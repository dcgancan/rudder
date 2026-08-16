import { getFormatter, getTranslations } from "next-intl/server";

import { createBot } from "@/app/[locale]/bots/actions";

/**
 * Bir stratejiden bot kurar.
 *
 * Kullanıcıya sorulan tek şey AD. Borsa, pariteler ve sermaye
 * `STANDARD_SETUP`'tan geliyor — yani bot, stratejinin ölçüldüğü ayarlarla
 * çalışıyor ve ekrandaki sayı gerçekten o botun sayısı oluyor.
 *
 * Ölçüm yoksa uyarı görünür ama düğme çalışır: kağıt üzerinde işlem risksiz,
 * asıl kapı gerçek parada. Kararı kullanıcı verir.
 */
export async function RunPanel({
  slug,
  defaultName,
  setup,
  measured,
  existingBots,
}: {
  slug: string;
  defaultName: string;
  setup: { pairs: number; exchange: string; wallet: number; currency: string };
  measured: boolean;
  existingBots: number;
}) {
  const t = await getTranslations();
  const format = await getFormatter();

  return (
    <section className="border-rule border-b py-8">
      <h2 className="label">{t("run.heading")}</h2>

      {measured ? null : (
        <p className="border-shoal text-ink-soft mt-4 max-w-xl border-l-2 py-1 pl-4 text-[0.95rem]">
          {t("run.unmeasured")}
        </p>
      )}

      <p className="text-ink-soft mt-4 max-w-xl text-[0.95rem]">{t("run.intro")}</p>

      <form action={createBot} className="mt-6">
        <input type="hidden" name="slug" value={slug} />

        <label className="label block" htmlFor="bot-name">
          {t("run.nameLabel")}
        </label>
        <input
          id="bot-name"
          name="name"
          required
          maxLength={80}
          defaultValue={defaultName}
          className="border-rule bg-surface text-ink mt-2 block w-full max-w-sm border px-3 py-2"
        />

        <p className="label sounding mt-5">
          {t("run.sameSetup", {
            count: setup.pairs,
            exchange: setup.exchange,
            wallet: format.number(setup.wallet),
            currency: setup.currency,
          })}
        </p>

        {existingBots > 0 ? (
          <p className="text-ink-soft mt-2 text-[0.95rem]">
            {t("run.existing", { count: existingBots })}
          </p>
        ) : null}

        <button
          type="submit"
          className="label border-ink text-ink hover:bg-ink hover:text-ground mt-5 cursor-pointer border bg-transparent px-4 py-2 transition-colors"
        >
          {t("run.create")}
        </button>
      </form>
    </section>
  );
}
