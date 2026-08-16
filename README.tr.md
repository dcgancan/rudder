# Rudder

[English](README.md) · **Türkçe**

**Python yazmayanlar için okunabilir alım-satım stratejileri.**

Rudder, [Freqtrade](https://github.com/freqtrade/freqtrade) üzerine kurulu açık
kaynak bir kripto alım-satım botudur. Stratejiler kod değil, **yapısal veridir** —
böylece bir stratejiyi sade dille okuyabilir, tek dosya olarak paylaşabilir ve
kod editörü yerine bir formda düzenleyebilirsiniz.

> ### ⚠️ Erken geliştirme aşaması
>
> Motor çalışıyor: kural setleri gerçek veriyle backtest ediliyor ve botlar
> kağıt üzerinde işlem yapabiliyor. Arayüz **strateji kataloğunu** gösteriyor ve
> **backtest çalıştırabiliyor** — bot yönetimi ve gerçek parayla işlem henüz yok.
> Heyecanlanmadan önce [Durum](#durum) bölümüne bakın.

---

## Neden

Mevcut açık kaynak botlar çok iyi ve çoğu insan için tamamen erişilemez.
Freqtrade bunların en iyisi — ve bir Freqtrade stratejisi, pandas kullanan bir
Python sınıfı. Bu, basit ve iyi anlaşılmış bir kuralı otomatikleştirmek isteyen
neredeyse herkesi devre dışı bırakıyor.

Strateji paylaşımını da tehlikeli hale getiriyor. Stratejiler kodsa, başkasının
stratejisini kopyalamak, yabancı birinin Python kodunu kendi makinenizde ve
borsa API anahtarlarınızı tutan bir süreçte çalıştırmak demektir.

Rudder stratejileri bunun yerine **yapısal veri** olarak temsil eder:

```json
{
  "timeframe": "1h",
  "indicators": [
    { "id": "rsi14",  "fn": "rsi", "params": { "period": 14 } },
    { "id": "ema200", "fn": "ema", "params": { "period": 200 } }
  ],
  "entry": {
    "all": [
      { "cmp": { "op": "lt", "left": "rsi14",  "right": 30 } },
      { "cmp": { "op": "gt", "left": "close",  "right": "ema200" } }
    ]
  },
  "exit": { "any": [ { "cmp": { "op": "gt", "left": "rsi14", "right": 70 } } ] },
  "risk": { "stoploss": -0.08, "roi": { "0": 0.04, "120": 0.02 } }
}
```

Tek bir jenerik Freqtrade strateji sınıfı bunu yorumlar. Kural setinden hiçbir
şey kod olarak çalıştırılmaz — yalnızca whitelist'teki fonksiyonları çağıran bir
yorumlayıcı tarafından gezilir.

Bu tek karar dört şeyi aynı anda sağlıyor:

| | |
|---|---|
| **Güvenlik** | Paylaşılan bir strateji rastgele kod çalıştıramaz |
| **Okunabilirlik** | Açıklama yapıdan üretilir, mantıktan asla sapamaz |
| **Çeviri** | Yeni bir dil, bir locale dosyası — metnin yeniden çevrilmesi değil |
| **Düzenleme** | "Değiştir ve çalıştır" bir form, editör değil |

## Üretilen açıklamalar

Aynı kural seti, iki dilde:

**Türkçe**
> **RSI Dip Alıcı** — 1h grafiği üzerinde değerlendirilir.
> RSI(14) 30 seviyesinin altına inerse ve fiyat 200 periyotluk EMA seviyesinin üzerine çıkarsa AL.
> RSI(14) 70 seviyesinin üzerine çıkarsa SAT.
> Zarar kes: %8 · Kâr al: hemen %4, 2 saat sonra %2

**English**
> **RSI Dip Buyer** — evaluated on the 1h chart.
> BUY when RSI(14) falls below 30 and price rises above the 200-period EMA.
> SELL when RSI(14) rises above 70.
> Stop loss at 8% · Take profit: 4% immediately, 2% after 2 hours

İki cümleyi de insan yazmadı.

## Durum

| Bileşen | Durum |
|---|---|
| Kural seti şeması | ✅ Çalışıyor |
| Jenerik strateji yorumlayıcısı | ✅ Çalışıyor, gerçek veriyle backtest edildi |
| Doğrulama / güvenlik sınırı | ✅ Çalışıyor, kötü niyetli kural setlerine karşı test edildi |
| Açıklama render'ı (TR + EN) | ✅ Çalışıyor |
| Veri modeli | ✅ Çalışıyor |
| Bot motoru (kağıt üzerinde) | ✅ Çalışıyor, gerçek container'larla doğrulandı |
| Web arayüzü | 🚧 Katalog, strateji yazma, backtest ve kağıt üzerinde botlar |
| Arayüzden backtest | ✅ Çalışıyor, gerçek container'larla doğrulandı |
| Bot ekranları (kur, çalıştır, durdur, kapat) | ✅ Çalışıyor, tarayıcıda uçtan uca sürüldü |
| Arayüzden strateji yazma | ✅ Çalışıyor — yaz, ölç, çalıştır |
| Gerçek parayla işlem | ⏳ Kimlik bilgisi şifrelemesi gerekiyor |
| Strateji paylaşımı | ❌ Başlanmadı |

Bugün Rudder çalışan bir motor ve onun üzerinde ince bir arayüz. Hemen
kullanabileceğiniz olgun bir bot arıyorsanız
[Freqtrade](https://github.com/freqtrade/freqtrade) veya
[OctoBot](https://github.com/Drakkar-Software/OctoBot) kullanın.

## Motoru denemek

Docker gerekiyor. Borsa API anahtarı gerekmiyor — aşağıdakilerin tamamı ya
çevrimdışı ya da halka açık piyasa verisi kullanıyor.

```sh
# Geçmiş veri indir
docker run --rm -v "$(pwd)/ft_lab/user_data:/freqtrade/user_data" \
  freqtradeorg/freqtrade:stable \
  download-data --config /freqtrade/user_data/config.json \
  --timerange 20260201- --timeframes 5m 1h

# Bir kural setini backtest et
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

Kural setini istediğiniz dilde render edin (Node 22.18+ ve pnpm gerekir):

```sh
pnpm install
pnpm describe rulesets/bb-bounce.json tr
pnpm test
```

## Arayüzü çalıştırmak

```sh
pnpm install
pnpm --filter @rudder/web seed    # migration + hazır kural setleri
pnpm --filter @rudder/web dev
```

`http://localhost:3000` — Türkçe için `/tr`, İngilizce için `/en`.

## Depo yapısı

| Yol | Ne |
|---|---|
| `rulesets/` | Küratörlü stratejiler ve reddedilmesi gereken `_invalid/` fixture'ları |
| `apps/web/` | Arayüz — Next.js, iki dilli |
| `packages/ruleset/` | Şema, doğrulama ve açıklama render'ı (TypeScript) |
| `packages/db/` | SQLite şeması ve bağlantısı |
| `packages/freqtrade/` | Config üretimi ve tipli REST istemcisi |
| `packages/orchestrator/` | Bot satırlarını çalışan container'lara çevirir |
| `packages/backtest/` | Kural setlerini geçmiş veri üzerinde çalıştırır ve sonucu saklar |
| `packages/host/` | Container çalışma zamanı ve disk yerleşimi |
| `engine/` | Freqtrade yorumlayıcısı — projedeki tek Python |
| `ft_lab/` | Tek kullanımlık Freqtrade keşif ortamı |

Belgeler: [`apps/web/README.md`](apps/web/README.md) ·
[`packages/ruleset/README.md`](packages/ruleset/README.md) ·
[`packages/db/README.md`](packages/db/README.md) ·
[`packages/freqtrade/README.md`](packages/freqtrade/README.md) ·
[`packages/orchestrator/README.md`](packages/orchestrator/README.md) ·
[`packages/backtest/README.md`](packages/backtest/README.md) ·
[`packages/host/README.md`](packages/host/README.md) ·
[`engine/README.md`](engine/README.md) ·
[`ft_lab/README.md`](ft_lab/README.md)

## Güvenlik ve risk

Alım-satım gerçek kayıp riski taşır. Rudder hiçbir garanti vermeden sunulur.
Kağıt üzerinde işlem (paper trading) varsayılandır ve bir stratejinin tam olarak
ne yaptığını anlayana kadar orada kalmalısınız.

**Bir stratejiyi nasıl değerlendirmeli.** Bu deponun kendi testlerinden çıkan
somut bir örnek: bir örnek strateji backtest'te **%82.4 kazanma oranı** verdi ve
buna rağmen **%11.57 kaybettirdi**. Kârlar %1–4 arasında alınmış, zararlar %10'a
kadar koşmuştu. Kazanma oranı sizi en çok yanıltacak metriktir — ve çoğu ürünün
vitrine koyduğu metrik tam olarak odur. Rudder bunun yerine profit factor,
expectancy ve maksimum drawdown'ı öne çıkarır.

Bir backtest'in geçmiş performansı, bir kuralın **kendisine göre seçildiği veri
üzerinde** nasıl davrandığını söyler. Tahmin değildir.

## Katkı

[CONTRIBUTING.md](CONTRIBUTING.md) dosyasına bakın. Strateji katkıları memnuniyetle
karşılanır ve sıradan pull request olarak incelenir — bir kural seti küçük bir
JSON dosyasıdır.

## Lisans

[GNU Affero General Public License v3.0](LICENSE).

Rudder, Freqtrade'den (GPL-3.0) türemiştir; AGPL-3.0 bununla uyumludur ve ek
olarak, değiştirilmiş bir sürümü ağ üzerinden hizmet olarak çalıştıran herkesin
değişikliklerini yayınlamasını şart koşar.

Copyright (C) 2026 Doğancan Öztürk
