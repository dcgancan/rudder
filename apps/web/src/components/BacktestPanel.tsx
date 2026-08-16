"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

import { useFormatter, useTranslations } from "next-intl";

import { startBacktest } from "@/app/[locale]/strategies/[slug]/actions";
import { useRouter } from "@/i18n/navigation";
import type { RunState } from "@/lib/strategies";

/**
 * Testi başlatan ve ilerlemesini izleyen yüzey.
 *
 * Kullanıcıya sorulan tek şey DÖNEM. Parite listesi, sermaye ve borsa sabit:
 * bunları sormak ürünün kaçınmaya çalıştığı Freqtrade yüzeyini geri getirir ve
 * her strateji farklı sermayeyle ölçülürse sonuçlar kıyaslanamaz hale gelir.
 *
 * Form bir SUNUCU EYLEMİNE bağlı, tıklama işleyicisine değil: JavaScript hiç
 * çalışmasa da (ya da henüz hidrasyon bitmemişken basılsa da) test başlar.
 * Buradaki istemci kodunun tek işi, çalışan bir testin bitişini görüp sayfayı
 * tazelemek.
 */

type Props = {
  slug: string;
  periods: readonly number[];
  fixture: { pairs: number; exchange: string; wallet: number; currency: string };
  /** Sunucudan gelen son durum. Tamamlanmış ölçüm burada değil, sayfada. */
  run: RunState | null;
  measured: boolean;
};

/** Backtest dakikalar sürüyor; daha sık sormanın karşılığı yok. */
const POLL_MS = 3000;

export function BacktestPanel({ slug, periods, fixture, run, measured }: Props) {
  const t = useTranslations();
  const format = useFormatter();
  const router = useRouter();

  const [months, setMonths] = useState(periods[Math.floor(periods.length / 2)] ?? 6);

  const running = run && run.status !== "failed" ? run : null;
  const watching = running?.id ?? null;

  useEffect(() => {
    if (!watching) return;

    let cancelled = false;
    const timer = setInterval(() => {
      void (async () => {
        try {
          const response = await fetch(`/api/backtests/${watching}`, { cache: "no-store" });
          if (!response.ok || cancelled) return;

          const { status } = (await response.json()) as { status: string };
          if (cancelled || (status !== "done" && status !== "failed")) return;

          router.refresh();
        } catch {
          // Geçici bir ağ hatası testi durdurmaz; bir sonraki turda sorulur.
        }
      })();
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [watching, router]);

  if (running) {
    return (
      <Panel heading={t("backtest.heading")}>
        <p className="text-lg">
          {running.status === "queued" ? t("backtest.queued") : t("backtest.running")}
          <span aria-hidden className="text-ink-soft">
            {" "}
            …
          </span>
        </p>
        <p className="text-ink-soft mt-3 max-w-xl text-[0.95rem]">{t("backtest.runningHelp")}</p>
      </Panel>
    );
  }

  const form = (
    <form action={startBacktest}>
      <input type="hidden" name="slug" value={slug} />

      <fieldset className="m-0 border-0 p-0">
        <legend className="label">{t("backtest.periodLegend")}</legend>

        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
          {periods.map((period) => (
            <label key={period} className="flex items-center gap-2">
              <input
                type="radio"
                name="months"
                value={period}
                checked={months === period}
                onChange={() => setMonths(period)}
                className="accent-depth"
              />
              {t("backtest.period", { months: period })}
            </label>
          ))}
        </div>
      </fieldset>

      <p className="label sounding mt-5">
        {t("backtest.fixture", {
          count: fixture.pairs,
          exchange: fixture.exchange,
          wallet: format.number(fixture.wallet),
          currency: fixture.currency,
        })}
      </p>
      <p className="text-ink-soft mt-2 max-w-xl text-[0.95rem]">{t("backtest.fixtureNote")}</p>

      <Submit label={t("backtest.start")} />
    </form>
  );

  return (
    <Panel heading={t("backtest.heading")}>
      {run?.status === "failed" ? <Failure detail={run.detail} /> : null}

      {measured ? (
        // Ölçüm zaten sayfada; formu açıkta tutmak sayfayı bir kontrol paneline
        // çevirirdi. Okuyan sayfa, tıklayan sayfa değil.
        <details className="mt-1">
          <summary className="text-depth cursor-pointer">{t("backtest.again")}</summary>
          <div className="mt-5">{form}</div>
        </details>
      ) : (
        <>
          <p className="text-ink-soft mt-3 max-w-xl text-[0.95rem]">{t("backtest.intro")}</p>
          <div className="mt-6">{form}</div>
        </>
      )}
    </Panel>
  );
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="label border-ink text-ink hover:bg-ink hover:text-ground mt-5 cursor-pointer border bg-transparent px-4 py-2 transition-colors disabled:cursor-default disabled:opacity-50"
    >
      {label}
    </button>
  );
}

function Panel({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="border-rule border-b py-8">
      <h2 className="label">{heading}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/**
 * Başarısızlık.
 *
 * Kullanıcıya çevrilmiş bir cümle gösteriliyor; Freqtrade'in İngilizce ham
 * çıktısı ayrı bir blokta duruyor. İkisini karıştırmak Türkçe arayüzde
 * İngilizce hata mesajı demek olurdu.
 */
function Failure({ detail }: { detail: string | null }) {
  const t = useTranslations();

  return (
    <div className="border-alert/40 mb-6 border-l-2 pl-5">
      <p className="text-alert text-lg">{t("backtest.failed")}</p>
      <p className="text-ink-soft mt-2 max-w-xl text-[0.95rem]">{t("backtest.failedHelp")}</p>

      {detail ? (
        <details className="mt-3">
          <summary className="label cursor-pointer">{t("backtest.failedDetail")}</summary>
          <pre className="text-ink-soft border-rule mt-3 max-h-64 overflow-auto border p-3 font-mono text-xs whitespace-pre-wrap">
            {detail}
          </pre>
        </details>
      ) : null}
    </div>
  );
}
