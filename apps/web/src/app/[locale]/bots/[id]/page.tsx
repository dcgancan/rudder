import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";

import { AutoRefresh } from "@/components/AutoRefresh";
import { BotStatusLabel } from "@/components/BotStatusLabel";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getBot } from "@/lib/bots";
import type { BotDetail } from "@/lib/bots";
import { durationParts } from "@/lib/duration";
import { displayable, PERCENT } from "@/lib/numbers";

import { closePosition, removeBot, startBot, stopBot } from "../actions";

/* Pozisyonlar ve cüzdan sürekli değişiyor. */
export const dynamic = "force-dynamic";

const REFRESH_MS = 5000;

type Props = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: Props) {
  const { locale, id } = await params;
  const bot = await getBot(id, locale);
  return bot ? { title: bot.name } : {};
}

export default async function BotPage({ params }: Props) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const bot = await getBot(id, locale);
  if (!bot) notFound();

  const t = await getTranslations();
  const format = await getFormatter();

  const percent = (value: number) => format.number(displayable(value), PERCENT);

  const money = (value: number) =>
    `${format.number(value, { maximumFractionDigits: 2 })} ${bot.currency}`;

  const moment = (ms: number) =>
    format.dateTime(new Date(ms), { dateStyle: "medium", timeStyle: "short" });

  const live = bot.status === "running" || bot.status === "starting";

  return (
    <>
      <SiteHeader />
      <AutoRefresh everyMs={REFRESH_MS} active={live} />

      <main id="content" className="mx-auto max-w-3xl px-6 pb-20">
        <nav className="pt-8">
          <Link href="/bots" className="label text-ink-soft hover:text-depth no-underline">
            ← {t("bots.backToList")}
          </Link>
        </nav>

        <header className="border-rule border-b pb-8">
          <div className="mt-6 flex flex-wrap items-baseline justify-between gap-4">
            <h1 className="font-display text-4xl font-semibold tracking-tight text-balance">
              {bot.name}
            </h1>
            <BotStatusLabel status={bot.status} />
          </div>

          <p className="text-ink-soft mt-4">
            {t("bots.runs")}:{" "}
            <Link href={`/strategies/${bot.strategy.slug}`} className="text-depth">
              {bot.strategy.name}
            </Link>{" "}
            <span className="sounding text-ink-soft">v{bot.strategy.version}</span>
          </p>

          {/*
            Bot belirli bir kural seti SÜRÜMÜNE bağlı ve öyle kalıyor. Bunu
            söylememek, açılmış bir işlemin hangi kurallarla açıldığı sorusunu
            cevapsız bırakır.
          */}
          {bot.strategy.outdated ? (
            <p className="text-ink-soft mt-2 max-w-xl text-[0.95rem]">
              {t("bots.outdated", { version: bot.strategy.version })}
            </p>
          ) : null}

          <p className="label sounding mt-4">
            {t("bots.paper")} ·{" "}
            {t("bots.setup", {
              count: bot.setup.pairs.length,
              exchange: bot.setup.exchange,
              stake: format.number(bot.setup.stake),
              currency: bot.currency,
              max: bot.setup.maxOpenTrades,
            })}
          </p>
        </header>

        {bot.status === "error" ? (
          <section className="border-alert/40 my-8 border-l-2 pl-5">
            <p className="text-alert text-lg">{t("bots.errorHeading")}</p>
            {bot.lastError ? (
              <details className="mt-3">
                <summary className="label cursor-pointer">{t("bots.errorDetail")}</summary>
                <pre className="text-ink-soft border-rule mt-3 max-h-64 overflow-auto border p-3 font-mono text-xs whitespace-pre-wrap">
                  {bot.lastError}
                </pre>
              </details>
            ) : null}
          </section>
        ) : null}

        {bot.status === "starting" ? (
          <p className="text-ink-soft border-rule border-b py-6 text-[0.95rem]">
            {t("bots.startingHelp")}
          </p>
        ) : null}

        {bot.live ? (
          <section className="border-rule grid grid-cols-1 gap-6 border-b py-8 sm:grid-cols-3">
            <Figure
              label={t("bots.wallet")}
              value={money(bot.live.balance)}
              // Karşılaştırma noktası kullanıcının kurduğu cüzdan; Freqtrade'in
              // `starting_capital`'ı `tradable_balance_ratio` ile kırpılmış bir
              // sayı ve onu ekranda açıklamanın yolu yok.
              note={
                bot.setup.wallet === null
                  ? t("bots.paper")
                  : `${t("bots.paper")} · ${t("bots.started")}: ${money(bot.setup.wallet)}`
              }
            />
            <Figure
              label={t("bots.profit")}
              value={percent(bot.live.profitRatio)}
              alert={bot.live.profitRatio < 0}
            />
            <Figure
              label={t("bots.openPositions")}
              value={format.number(bot.live.openPositions)}
            />
          </section>
        ) : null}

        <Controls bot={bot} />

        {bot.status === "running" ? (
          <section className="border-rule border-b py-8">
            <h2 className="label">{t("bots.positions")}</h2>

            {bot.positions.length === 0 ? (
              <p className="text-ink-soft mt-4 text-[0.95rem]">{t("bots.noPositions")}</p>
            ) : (
              <ul className="mt-4 list-none p-0">
                {bot.positions.map((position) => (
                  <li key={position.tradeId} className="border-rule border-t py-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                      <span className="sounding">{position.pair}</span>
                      <span
                        className={`sounding ${
                          (position.profitRatio ?? 0) < 0 ? "text-alert" : ""
                        }`}
                      >
                        {position.profitRatio === null ? "—" : percent(position.profitRatio)}
                      </span>
                    </div>
                    <p className="text-ink-soft mt-1 text-[0.9rem]">
                      {t("bots.opened")}: {moment(position.openedAt)} · {money(position.stake)}
                    </p>

                    {/*
                      Geri alınamaz: pozisyon piyasa fiyatından kapanır ve
                      kâr ya da zarar kesinleşir. Açılışta gizli olması,
                      JavaScript çalışmasa da geçerli bir koruma.
                    */}
                    <details className="mt-2">
                      <summary className="label cursor-pointer">{t("bots.closeNow")}</summary>
                      <p className="text-ink-soft mt-2 max-w-lg text-[0.9rem]">
                        {t("bots.closeHelp")}
                      </p>
                      <form action={closePosition} className="mt-3">
                        <input type="hidden" name="botId" value={bot.id} />
                        <input type="hidden" name="tradeId" value={position.tradeId} />
                        <SubmitButton label={t("bots.closeConfirm")} tone="alert" />
                      </form>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        <section className="py-8">
          <h2 className="label">{t("bots.history")}</h2>

          {bot.history.length === 0 ? (
            <p className="text-ink-soft mt-4 text-[0.95rem]">{t("bots.noHistory")}</p>
          ) : (
            <ul className="mt-4 list-none p-0">
              {bot.history.map((trade) => (
                <li
                  key={trade.id}
                  className="border-rule flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-t py-3"
                >
                  <span className="sounding">{trade.pair}</span>
                  <span className="text-ink-soft flex-1 text-[0.9rem]">
                    {t(`measurement.exit.${trade.exitReason}`)}
                    {trade.heldSeconds !== null ? ` · ${held(trade.heldSeconds)}` : ""}
                  </span>
                  <span
                    className={`sounding text-[0.95rem] ${
                      (trade.profitRatio ?? 0) < 0 ? "text-alert" : ""
                    }`}
                  >
                    {trade.profitRatio === null ? "—" : percent(trade.profitRatio)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      <SiteFooter />
    </>
  );

  function held(seconds: number): string {
    const parts = durationParts(seconds);
    return t(parts.key, parts.values);
  }
}

/**
 * Başlat / durdur ve kaldır.
 *
 * Hepsi düz form; iki adımlı olanlar `<details>` ile gizleniyor. Bir istemci
 * bileşeniyle onay almak, hidrasyon tamamlanmadan basılan düğmenin doğrudan
 * gönderilmesi demek olurdu — geri alınamaz bir işlemde kabul edilemez.
 */
async function Controls({ bot }: { bot: BotDetail }) {
  const t = await getTranslations();
  const stoppable = bot.status === "running" || bot.status === "starting";

  return (
    <section className="border-rule flex flex-wrap items-start gap-x-6 gap-y-4 border-b py-8">
      <form action={stoppable ? stopBot : startBot}>
        <input type="hidden" name="botId" value={bot.id} />
        <SubmitButton label={stoppable ? t("bots.stop") : t("bots.start")} />
      </form>

      <details className="grow">
        <summary className="label text-ink-soft hover:text-alert cursor-pointer py-2">
          {t("bots.remove")}
        </summary>
        <p className="text-ink-soft mt-2 max-w-lg text-[0.9rem]">{t("bots.removeHelp")}</p>
        <form action={removeBot} className="mt-3">
          <input type="hidden" name="botId" value={bot.id} />
          <SubmitButton label={t("bots.removeConfirm")} tone="alert" />
        </form>
      </details>
    </section>
  );
}

function SubmitButton({ label, tone }: { label: string; tone?: "alert" }) {
  const colours =
    tone === "alert"
      ? "border-alert text-alert hover:bg-alert hover:text-ground"
      : "border-ink text-ink hover:bg-ink hover:text-ground";

  return (
    <button
      type="submit"
      className={`label cursor-pointer border bg-transparent px-4 py-2 transition-colors ${colours}`}
    >
      {label}
    </button>
  );
}

function Figure({
  label,
  value,
  note,
  alert = false,
}: {
  label: string;
  value: string;
  note?: string;
  alert?: boolean;
}) {
  return (
    <div>
      <p className="label">{label}</p>
      <p className={`sounding mt-1 text-2xl ${alert ? "text-alert" : ""}`}>{value}</p>
      {note ? <p className="text-ink-soft mt-1 text-[0.9rem]">{note}</p> : null}
    </div>
  );
}
