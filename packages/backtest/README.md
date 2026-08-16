# @rudder/backtest

Kural setlerini geçmiş fiyat verisi üzerinde çalıştırır ve sonucu saklar.

## Sorumluluk

| | |
|---|---|
| `BacktestQueue` | Sıraya alma, tekilleştirme, kurtarma |
| `BacktestRunner` | Tek bir satırı container'lardan sonuca kadar yürütür |
| `parseResult` | Freqtrade çıktısını metriklere ve saklanacak özete indirger |
| `drawdownFromTrades` | Düşüş eğrisi |

Saf olan kısım (`./result`) ayrı bir alt yoldan dışa açılıyor: arayüz eğriyi ve
tipleri oradan alıyor ve bir React sunucu bileşeninin `node:child_process`
çekmesi için sebep yok.

## Kararlar

### Testin tanımı sabit

Kullanıcıya sorulan tek şey **dönem** (3 / 6 / 12 ay). Borsa, parite listesi ve
sermaye [`@rudder/freqtrade`](../freqtrade/README.md)'deki `STANDARD_SETUP`'tan
geliyor — aynı sabiti botlar da kullanıyor, yani bir bot ölçümün ayarlarından
sapamıyor.

İki gerekçe: bunları sormak ürünün kaçınmaya çalıştığı Freqtrade yüzeyini geri
getirir, ve her strateji farklı sermayeyle ölçülürse çıkan sayılar birbiriyle
kıyaslanamaz hale gelir. Karşılaştırılabilirlik esnekliğe tercih edildi.

### Aralığın sonu sabitlenir

`--timerange` her zaman `YYYYMMDD-YYYYMMDD`. Açık uçlu bir aralık aynı satırı
yarın farklı bir sonuç verir hale getirir; yeniden üretilemeyen bir ölçüm ölçüm
değildir.

İndirme aralığı `400 × timeframe` kadar geriden başlar. 400, motorun
`startup_candle_count` üst sınırı. Freqtrade istenen aralıktan önceki mumları
ısınma için kullanıyor; orada veri yoksa hata vermez, backtest'i sessizce daha
geç başlatır — "son 12 ay" deyip 11 ay ölçmek olurdu.

Ekranda gösterilen dönem yine de istenen değil **gerçekleşen** dönemdir
(`backtest_start_ts` / `backtest_end_ts`).

### Önbellek kapalı olmak zorunda

Freqtrade backtest sonuçlarını strateji **dosyasının** hash'iyle önbelleğe
alıyor. Bizde o dosya bütün kural setleri için aynı `universal_strategy.py`.
`--cache none` olmazsa bir kural setinin sonucu bambaşka bir kural seti için
geri döner ve hiçbir yerde hata vermez.

Aynı sebeple `--timeframe` **hiç geçilmez**: o bayrak stratejinin zaman dilimini
ezer ve kural setinin sessizce yok sayılmasına yol açar. Bir test bunu
sabitliyor.

### Düşüş eğrisi işlem bazında hesaplanır

`daily_profit` çok daha küçük ve ilk bakışta yeterli görünüyor. Değil: gün
içindeki dip gün sonunda toparlandığında o dibi hiç görmüyor.

Ölçüldü — 194 günlük bir testte iki yöntem birbirini tuttu, 31 günlük bir
testte günlük yöntem düşüşü **%1,4137** gösterdi, Freqtrade'in ölçtüğü
**%1,4303** yerine. Hata her zaman **az gösterme** yönünde, ve bu üründe riski
olduğundan küçük göstermek kabul edilebilir bir hata değil.

Eğri bu yüzden kapanan işlemlerden türetiliyor ve en derin noktası Freqtrade'in
`max_drawdown_account` değerine birebir eşit. İki gerçek koşu üzerinde iki test
bunu sabitliyor, üçüncüsü de günlük yönteme dönüşü engelliyor.

### Veritabanına özet, diske tam kayıt

Freqtrade'in çıktısı 440 KB; 385 KB'ı `trades[]`, 35 KB'ı `periodic_breakdown`.
Satıra yazılan ~22 KB'lık özet metrikleri, dökümleri ve türetilmiş eğriyi
taşıyor. Tam kayıt `<dataRoot>/backtests/<id>/results/*.zip` içinde duruyor;
işlem listesi ekranı gerektiğinde oradan okunur.

`daily_profit` da düşürülüyor — sebebi boyut değil, yanlış cevap veren bir
kısayolu veride bırakmanın er ya da geç kullanılması.

### Sıfır işlem başarısızlık değildir

Hiç sinyal üretmeyen bir kural seti `done` + `totalTrades: 0` olur. Arayüz bunu
ayrı bir durum olarak söyler: boş bir eğri "test edildi, düşüş yok" diye okunur
ve bu yalan olur.

### Kuyruk veritabanının kendisi

Bellekte ikinci bir liste yok; sıradaki iş her seferinde en eski `queued` satır
olarak sorgulanıyor. Süreç ölüp geri geldiğinde bekleyenler kaybolmuyor.

`recover()` kalıntı `running` satırları `failed`/`interrupted` yapar ve yetim
container'ları siler. Yarıda kalanı sessizce yeniden başlatmak kullanıcının
kararı olmaz. Web tarafında bu, ilk isteğe değil **sunucu açılışına** bağlı
(`apps/web/src/instrumentation.ts`) — ölçüldü, aksi halde bekleyen işler kimse
yeni bir test başlatana kadar hiç başlamıyor.

## Yerleşim

```
<dataRoot>/backtests/<id>/
  ruleset.json   → /freqtrade/ruleset.json                (ro)
  config.json    → /freqtrade/backtest/config.json        (ro)
  results/       → /freqtrade/backtest/results            (rw)
  run.log        yalnızca host tarafında
<dataRoot>/market-data/<exchange>/ → /freqtrade/backtest/data  (rw, PAYLAŞILAN)
engine/          → /freqtrade/engine                      (ro)
```

Mum verisi borsa başına tutulur ve bütün testler paylaşır: `download-data`
artımlıdır, ikinci çalıştırma yalnızca eksiği çeker.

Başarısız bir çalıştırmanın dizini **silinmez**. `run.log` container gittikten
sonra geriye kalan tek teşhis kaynağı.

## Zip okuyucu

Freqtrade sonucu zip'liyor ve `--export-filename` kullanımdan kalktığı için
bunu kapatmanın yolu yok; Node'da da yerleşik zip desteği yok. `src/zip.ts`
ihtiyacımız kadarını yazıyor — bir bağımlılık ya da harici `unzip` ikilisi
getirmemek için.

## Kullanım

```ts
const queue = new BacktestQueue({ db });
await queue.recover();

const id = queue.enqueue({ rulesetId, months: 6 });
await queue.drain();
```

## Testler

```sh
pnpm --filter @rudder/backtest test
RUDDER_INTEGRATION=1 pnpm --filter @rudder/backtest test
```

Entegrasyon testi gerçek Docker ile zincirin tamamını doğrular: veritabanı
satırı → indirilmiş mum verisi → backtest → ayrıştırılmış sonuç, ve veri
bulunamayan bir koşunun `failed` olarak kaydedildiğini.

## Henüz yok

- **İşlem listesi ekranı.** Veri diskteki zip'te duruyor, okuyan yok.
- **İptal.** Çalışan bir testi arayüzden durdurmanın yolu yok; container'ın
  kendi zaman aşımı (indirme 15 dk, backtest 30 dk) tek sınır.
- **Paralellik.** İşler seri çalışıyor. Backtest CPU-yoğun, ikisini aynı anda
  koşturmak ikisini birden yavaşlatır.
