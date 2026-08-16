# engine

Kural setlerini yürüten Freqtrade stratejisi. Projedeki **tek Python dosyası**
burada ve öyle kalmalı.

## Ne yapar

`UniversalStrategy`, `FT_RULESET` ortam değişkeninin gösterdiği JSON kural
setini okur, doğrular ve yorumlar. Her bot kendi kural setiyle aynı imajdan
ayağa kalkar — strateji başına ayrı Python dosyası yoktur.

Kural setinden hiçbir şey kod olarak çalıştırılmaz. Modülün tamamı, yalnızca
whitelist'teki fonksiyon ve operatörleri çağıran bir yorumlayıcıdır.

## İki katmanlı doğrulama

Aynı kurallar kasıtlı olarak iki yerde tutulur:

| Katman | Nerede | Ne zaman |
|---|---|---|
| TypeScript | [`packages/ruleset`](../packages/ruleset) | Kaydetmeden önce |
| Python | `_validate()` | Çalıştırmadan önce |

Biri atlanırsa diğeri yakalar. **Birini genişletirken diğerini de genişlet** —
whitelist'ler (`INDICATOR_FNS`, `COMPARISON_OPS`, `SINGLE_OUTPUT_FNS`,
`MULTI_OUTPUT_FNS`) iki tarafta aynı olmalıdır.

[`rulesets/_invalid/`](../rulesets/_invalid) içindeki her dosyanın iki katmanda
da reddedildiği doğrulanmıştır:

| Fixture | Red gerekçesi |
|---|---|
| `unknown-fn` | `Unknown indicator function: '__import__'` |
| `unknown-operand` | `Unknown operand in entry: "os.system('id')"` |
| `shadow-column` | `Indicator id shadows an OHLCV column: 'close'` |
| `bad-operator` | `Unknown operator in entry: '__reduce__'` |
| `missing-period` | `rsi requires a period` |
| `missing-output` | `bbands produces multiple series` |

## Çalıştırma

Repo kökünden. `engine` ve `rulesets` salt okunur mount edilir.

```sh
docker run --rm \
  -v "$(pwd)/ft_lab/user_data:/freqtrade/user_data" \
  -v "$(pwd)/engine:/freqtrade/engine:ro" \
  -v "$(pwd)/rulesets:/freqtrade/rulesets:ro" \
  -e FT_RULESET=/freqtrade/rulesets/rsi-dip-buyer.json \
  freqtradeorg/freqtrade:stable \
  backtesting --config /freqtrade/user_data/config.json \
  --strategy UniversalStrategy --strategy-path /freqtrade/engine \
  --timerange 20260201- --cache none
```

Veri indirme ve canlı dry-run için: [`ft_lab/README.md`](../ft_lab/README.md)

## Kural setinden türetilenler

Freqtrade'in sınıf nitelikleri modül yüklenirken kural setinden hesaplanır:

| Freqtrade | Kaynak |
|---|---|
| `timeframe` | `ruleset.timeframe` |
| `minimal_roi` | `ruleset.risk.roi` |
| `stoploss` | `ruleset.risk.stoploss` |
| `trailing_stop*` | `ruleset.risk.trailing` |
| `startup_candle_count` | En uzun indikatör periyodunun 2 katı, 30–400 arası |
| `use_exit_signal` | `exit` bloğu var mı |

İki davranış kural setinden gelmez, sabittir:

- **`order_types.force_exit` = market.** Limit emir asılı kalabilir; "hemen sat"
  davranışının gerçekten hemen olması gerekiyor.
- **Giriş koşuluna örtük `volume > 0` eklenir** — boş mumda işlem açılmasın diye.

## Bilinen sınırlar (v1)

- İndikatörler: `rsi`, `ema`, `sma`, `macd`, `bbands`, `atr`, `adx`
- Yalnızca long (`can_short = False`)
- Tek zaman dilimi — informative pair desteği yok
- Pozisyon boyutlandırma kural setinde değil, kullanıcı ayarında
