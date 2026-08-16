# Rudder — readable trading strategies
# Copyright (C) 2026 Doğancan Öztürk
#
# This program is free software: you can redistribute it and/or modify it under
# the terms of the GNU Affero General Public License as published by the Free
# Software Foundation, either version 3 of the License, or (at your option) any
# later version. It is distributed WITHOUT ANY WARRANTY; without even the
# implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
# See <https://www.gnu.org/licenses/> for the full license.

# pragma pylint: disable=missing-docstring, invalid-name
"""
Kural setlerini yürüten tek jenerik Freqtrade stratejisi.

Kullanıcı Python yazmaz; JSON kural seti tanımlar ve bu sınıf onu yorumlar.
Kullanıcı girdisi hiçbir noktada kod olarak çalıştırılmaz — bu modülün
tamamı, yalnızca whitelist'teki fonksiyon ve operatörleri çağıran bir
yorumlayıcıdır. Güvenlik sınırı budur.

Kural seti yolu FT_RULESET ortam değişkeninden okunur; her kullanıcı
container'ı kendi kural setiyle ayağa kalkar.
"""

import json
import os
from functools import reduce
from pathlib import Path

import talib.abstract as ta
from pandas import DataFrame, Series
from technical import qtpylib

from freqtrade.strategy import IStrategy


OHLCV_COLUMNS = ("open", "high", "low", "close", "volume")

# Bu iki tablonun dışında hiçbir şey çağrılamaz. Şema da aynı listeyi
# doğrular; burada ikinci kez tutulması kasıtlı (defense in depth).
INDICATOR_FNS = ("rsi", "ema", "sma", "macd", "bbands", "atr", "adx")
COMPARISON_OPS = ("lt", "lte", "gt", "gte", "cross_above", "cross_below")

# Çok çıktılı indikatörlerde şema adı -> kütüphane sütun adı.
MACD_OUTPUTS = {"macd": "macd", "signal": "macdsignal", "hist": "macdhist"}
BBANDS_OUTPUTS = {"lower": "lower", "middle": "mid", "upper": "upper"}

DEFAULT_RULESET = "/freqtrade/strategy_engine/rulesets/rsi-dip-buyer.json"


class RulesetError(ValueError):
    """Kural seti reddedildi. Mesaj son kullanıcıya gösterilebilir olmalı."""


# --------------------------------------------------------------------------
# Doğrulama
# --------------------------------------------------------------------------


def _validate(ruleset: dict) -> dict:
    if ruleset.get("schema_version") != 1:
        raise RulesetError(f"Unsupported schema_version: {ruleset.get('schema_version')!r}")

    seen: set[str] = set()
    for spec in ruleset.get("indicators", []):
        ind_id, fn = spec.get("id"), spec.get("fn")
        if fn not in INDICATOR_FNS:
            raise RulesetError(f"Unknown indicator function: {fn!r}")
        if ind_id in OHLCV_COLUMNS:
            raise RulesetError(f"Indicator id shadows an OHLCV column: {ind_id!r}")
        if ind_id in seen:
            raise RulesetError(f"Duplicate indicator id: {ind_id!r}")
        seen.add(ind_id)

    known = seen | set(OHLCV_COLUMNS)
    for branch in ("entry", "exit"):
        if branch in ruleset:
            _validate_condition(ruleset[branch], known, branch)

    if "entry" not in ruleset:
        raise RulesetError("Ruleset has no entry condition")

    return ruleset


def _validate_condition(node: dict, known: set[str], where: str) -> None:
    if not isinstance(node, dict) or len(node) != 1:
        raise RulesetError(f"Malformed condition node in {where}: {node!r}")

    (key, value), = node.items()

    if key in ("all", "any"):
        if not isinstance(value, list) or not value:
            raise RulesetError(f"{key!r} in {where} must be a non-empty list")
        for child in value:
            _validate_condition(child, known, where)
        return

    if key == "not":
        _validate_condition(value, known, where)
        return

    if key == "cmp":
        if value.get("op") not in COMPARISON_OPS:
            raise RulesetError(f"Unknown operator in {where}: {value.get('op')!r}")
        for side in ("left", "right"):
            operand = value.get(side)
            if isinstance(operand, (int, float)) and not isinstance(operand, bool):
                continue
            if operand not in known:
                raise RulesetError(f"Unknown operand in {where}: {operand!r}")
        return

    raise RulesetError(f"Unknown condition key in {where}: {key!r}")


def _load_ruleset() -> dict:
    path = Path(os.environ.get("FT_RULESET", DEFAULT_RULESET))
    return _validate(json.loads(path.read_text()))


RULESET = _load_ruleset()


# --------------------------------------------------------------------------
# Kural setinden Freqtrade sınıf niteliklerini türet
# --------------------------------------------------------------------------


def _startup_candles(ruleset: dict) -> int:
    """En uzun indikatör periyodunun iki katı — ısınma için güvenli pay."""
    periods = [
        value
        for spec in ruleset.get("indicators", [])
        for key, value in spec.get("params", {}).items()
        if key in ("period", "slow")
    ]
    return max(30, min(400, (max(periods) if periods else 20) * 2))


def _roi(ruleset: dict) -> dict:
    # Freqtrade minimal_roi anahtarlarını dakika olarak bekler.
    roi = ruleset["risk"].get("roi")
    return {str(k): float(v) for k, v in roi.items()} if roi else {"0": 10.0}


_TRAILING = RULESET["risk"].get("trailing", {"enabled": False})


class UniversalStrategy(IStrategy):
    INTERFACE_VERSION = 3

    timeframe = RULESET["timeframe"]
    can_short = False

    minimal_roi = _roi(RULESET)
    stoploss = float(RULESET["risk"]["stoploss"])

    trailing_stop = bool(_TRAILING.get("enabled", False))
    trailing_stop_positive = _TRAILING.get("positive")
    trailing_stop_positive_offset = float(_TRAILING.get("positive_offset", 0.0))
    trailing_only_offset_is_reached = bool(_TRAILING.get("only_offset_is_reached", False))

    startup_candle_count: int = _startup_candles(RULESET)

    process_only_new_candles = True
    use_exit_signal = "exit" in RULESET
    exit_profit_only = False
    ignore_roi_if_entry_signal = False

    order_types = {
        "entry": "limit",
        "exit": "limit",
        # Panik satış anında dolmama riski olmaması için market.
        "force_exit": "market",
        "emergency_exit": "market",
        "stoploss": "market",
        "stoploss_on_exchange": False,
    }

    # ----------------------------------------------------------------- #
    # Indicators
    # ----------------------------------------------------------------- #

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        for spec in RULESET.get("indicators", []):
            dataframe[spec["id"]] = self._build_indicator(dataframe, spec)
        return dataframe

    def _build_indicator(self, dataframe: DataFrame, spec: dict) -> Series:
        fn = spec["fn"]
        params = spec.get("params", {})

        if fn == "rsi":
            return ta.RSI(dataframe, timeperiod=params["period"])
        if fn == "ema":
            return ta.EMA(dataframe, timeperiod=params["period"])
        if fn == "sma":
            return ta.SMA(dataframe, timeperiod=params["period"])
        if fn == "atr":
            return ta.ATR(dataframe, timeperiod=params["period"])
        if fn == "adx":
            return ta.ADX(dataframe, timeperiod=params["period"])

        if fn == "macd":
            macd = ta.MACD(
                dataframe,
                fastperiod=params.get("fast", 12),
                slowperiod=params.get("slow", 26),
                signalperiod=params.get("signal", 9),
            )
            return macd[MACD_OUTPUTS[spec.get("output", "macd")]]

        if fn == "bbands":
            bands = qtpylib.bollinger_bands(
                qtpylib.typical_price(dataframe),
                window=params.get("period", 20),
                stds=params.get("stds", 2),
            )
            return bands[BBANDS_OUTPUTS[spec.get("output", "middle")]]

        # _validate() buraya düşmeyi engeller; yine de sessiz kalmıyoruz.
        raise RulesetError(f"Unhandled indicator function: {fn!r}")

    # ----------------------------------------------------------------- #
    # Condition tree
    # ----------------------------------------------------------------- #

    def _operand(self, dataframe: DataFrame, ref):
        return ref if isinstance(ref, (int, float)) else dataframe[ref]

    def _evaluate(self, dataframe: DataFrame, node: dict) -> Series:
        (key, value), = node.items()

        if key == "all":
            return reduce(lambda a, b: a & b, (self._evaluate(dataframe, c) for c in value))
        if key == "any":
            return reduce(lambda a, b: a | b, (self._evaluate(dataframe, c) for c in value))
        if key == "not":
            return ~self._evaluate(dataframe, value)

        op = value["op"]
        left = self._operand(dataframe, value["left"])
        right = self._operand(dataframe, value["right"])

        if op == "lt":
            return left < right
        if op == "lte":
            return left <= right
        if op == "gt":
            return left > right
        if op == "gte":
            return left >= right
        if op == "cross_above":
            return qtpylib.crossed_above(left, right)
        if op == "cross_below":
            return qtpylib.crossed_below(left, right)

        raise RulesetError(f"Unhandled operator: {op!r}")

    # ----------------------------------------------------------------- #
    # Signals
    # ----------------------------------------------------------------- #

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        # Boş mumda işlem açmamak için hacim koşulu her kural setine örtük eklenir.
        condition = self._evaluate(dataframe, RULESET["entry"]) & (dataframe["volume"] > 0)
        dataframe.loc[condition, ["enter_long", "enter_tag"]] = (1, RULESET["id"])
        return dataframe

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        if "exit" not in RULESET:
            return dataframe
        condition = self._evaluate(dataframe, RULESET["exit"]) & (dataframe["volume"] > 0)
        dataframe.loc[condition, ["exit_long", "exit_tag"]] = (1, RULESET["id"])
        return dataframe
