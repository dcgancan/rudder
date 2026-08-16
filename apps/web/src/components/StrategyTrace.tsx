import { getFormatter, getTranslations } from "next-intl/server";

import type { StrategyView } from "@/lib/strategies";

import { UnderwaterTrace } from "./UnderwaterTrace";

/**
 * Eğrinin başlığını kuran sarmalayıcı.
 *
 * Üç durumun ayrımı tek yerde duruyor — katalog ve detay sayfası aynı cümleyi
 * iki farklı yerde kurarsa er ya da geç ayrışırlar.
 */
export async function StrategyTrace({ strategy }: { strategy: StrategyView }) {
  const t = await getTranslations();
  const format = await getFormatter();

  return <UnderwaterTrace points={strategy.drawdown} caption={await caption()} />;

  async function caption(): Promise<string> {
    if (strategy.drawdown === null) return t("drawdown.untested");
    if (strategy.drawdown.length <= 1) return t("backtest.noTrades");

    return t("drawdown.depth", {
      value: format.number(strategy.measurement?.maxDrawdown ?? 0, {
        style: "percent",
        maximumFractionDigits: 1,
      }),
    });
  }
}
