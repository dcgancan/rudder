# strategy_engine

Stratejilerin **çalıştırılabilir kod yerine yapısal veri** olarak temsil edildiği
katman. Ürünün temel taşı budur.

## Neden

Freqtrade'de strateji = Python kodu. Kullanıcıların birbirinin stratejisini
kopyalayıp çalıştırdığı bir pazaryerinde bu, yabancı kodu kendi altyapımızda ve
kullanıcının borsa anahtarlarına erişimi olan bir process'te çalıştırmak demektir.

Stratejiyi veriye çevirmek dört problemi aynı anda çözer:

| Problem | Çözümü |
|---|---|
| Güvenlik | Kod çalışmaz; whitelist'teki fonksiyonlar yorumlanır |
| Sade dil açıklaması | Yapıdan otomatik üretilir, koda göre asla yanlış olamaz |
| Çok dillilik | Aynı yapı, farklı locale dosyası |
| "Düzenleyip başlat" | Kod editörü değil, form |

## Yapı

```
schema/ruleset.schema.json      Kural seti şeması — birincil güvenlik sınırı
rulesets/*.json                 Örnek kural setleri
rulesets/_invalid/*.json        Doğrulamayı test eden kötü niyetli örnekler
freqtrade/universal_strategy.py Kural setini yürüten tek jenerik strateji
describe/describe.mjs           Kural seti -> okunabilir açıklama
describe/locales/{en,tr}.json   Dil dosyaları
```

## Güvenlik modeli

İki bağımsız katman, kasıtlı olarak birbirini tekrar eder:

1. **Şema doğrulaması** (ürün katmanı, kayıttan önce) — `fn` ve `op` değerleri
   sabit enum'lardan gelmek zorunda, serbest metin yok.
2. **Yükleme doğrulaması** (`universal_strategy.py` içindeki `_validate`) —
   indikatör id çakışması, tanımsız operand, bilinmeyen fonksiyon/operatör.

Doğrulanmış örnekler (`rulesets/_invalid/`):

| Saldırı | Sonuç |
|---|---|
| `"fn": "__import__"` | `Unknown indicator function` |
| `"left": "os.system('id')"` | `Unknown operand in entry` |
| `"id": "close"` (OHLCV gölgeleme) | `Indicator id shadows an OHLCV column` |
| `"op": "__reduce__"` | `Unknown operator in entry` |

Kullanıcı girdisi hiçbir noktada `eval`, `exec` ya da `import`'a ulaşmaz.

## Kural seti çalıştırma

`FT_RULESET` ortam değişkeni ile — her kullanıcı container'ı kendi kural setiyle
ayağa kalkar:

```sh
docker run --rm \
  -v "$(pwd)/ft_lab/user_data:/freqtrade/user_data" \
  -v "$(pwd)/strategy_engine:/freqtrade/strategy_engine:ro" \
  -e FT_RULESET=/freqtrade/strategy_engine/rulesets/rsi-dip-buyer.json \
  freqtradeorg/freqtrade:stable \
  backtesting --config /freqtrade/user_data/config.json \
  --strategy UniversalStrategy \
  --strategy-path /freqtrade/strategy_engine/freqtrade \
  --timerange 20260201- --cache none
```

`strategy_engine` **salt okunur** mount edilir.

## Açıklama üretme

```sh
node strategy_engine/describe/describe.mjs strategy_engine/rulesets/bb-bounce.json tr
```

`describe()` yapısal bir nesne döndürür (arayüz bunu bileşen olarak render eder);
`toText()` yalnızca CLI/demo içindir.

### Yeni dil ekleme

`describe/locales/<kod>.json` dosyası eklemek yeterli — kod değişmez.

### Dil dosyası yazarken dikkat

Bunlar prototipte fiilen karşılaşılan ve düzeltilen hatalardır:

- **Kelime sırası koda gömülemez.** İngilizce `BUY when X`, Türkçe `X AL`.
  Cümle kalıbı `entry_sentence` / `exit_sentence` ile locale'den gelir.
- **Büyük harf locale duyarlıdır.** `"işlem"` -> `"İşlem"`; düz `toUpperCase()`
  `"Islem"` üretir ve yanlıştır. `toLocaleUpperCase(locale)` kullanılır.
- **Sayı ve yüzde biçimi `Intl`'e bırakılır.** Türkçe'de yüzde işareti önde
  (`%8`), ondalık ayracı virgül (`%1,5`), binlik ayracı nokta (`1.000`).
  Bunların hiçbiri elle yazılmaz.
- **Ek uyumundan kaçınılır.** `"{right} seviyesinin altına inerse"` kalıbı her
  sayı için çalışır; `"30'un altına"` çalışmaz.

## Bilinen sınırlar (v1)

- İndikatör whitelist'i 7 fonksiyonla sınırlı: `rsi`, `ema`, `sma`, `macd`,
  `bbands`, `atr`, `adx`.
- Yalnızca long. `can_short = False`.
- Tek zaman dilimi — çoklu timeframe (informative pair) desteği yok.
- Pozisyon boyutlandırma kural setinde değil, kullanıcı ayarında.
