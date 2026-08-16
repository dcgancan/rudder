# @rudder/db

SQLite şeması ve bağlantısı. Drizzle ORM + `better-sqlite3`.

## Şemanın şeklini belirleyen üç karar

### 1. Kural setleri değişmezdir

Bir kural setini düzenlemek mevcut satırı güncellemez, **yeni bir sürüm satırı**
yaratır. `(slug, version)` benzersizdir ve bir bot her zaman belirli bir sürüme
bağlıdır.

Sebep: kural setleri değiştirilebilir olsaydı, bir botun geçmişi yorumlanamaz
hale gelirdi — "bu işlem hangi kurallarla açıldı?" sorusunun cevabı olmazdı.
Ayrıca çalışan bir botun davranışı, kullanıcı stratejiyi düzenlediği anda
sessizce değişirdi.

Bu, pazaryeri tarafındaki **"kopyala, takip etme"** ilkesinin iç karşılığıdır.

### 2. Botlar soft-delete edilir

`bots.deleted_at` doldurulur, satır silinmez. İşlem geçmişi bot kaldırıldıktan
sonra da durur — stratejileri birbiriyle karşılaştırabilmenin tek yolu bu.

### 3. Bir botun başına gelenler ayrı bir tabloda tutulur

Botlar `--restart unless-stopped` ile çalışıyor, yani çöken bir botu Docker
geri getiriyor. Bunun sonucu ölçüldü: kullanıcı sabah baktığında bot
**"çalışıyor"** görünüyor ve gece kırk kez çöktüğüne dair hiçbir iz kalmıyor.

Tek bir "son hata" sütunu bu bilgiyi tutamaz — bir sonraki başarılı açılışta
silinir. `bot_events` bu yüzden var: eklemeli, silinmeyen bir kayıt.

Satırlar yalnızca **geçişte** yazılır, her yoklamada değil. Çöküp duran bir bot
`failed` olarak bir kez yazılır; Docker onu geri getirmeye devam ettiği için
aksi halde on beş saniyede bir satır üretirdi. Kullanıcının kendi istediği
şeyler hiç yazılmaz: botu durdurmak olay değildir. Bir entegrasyon testi
baştan sona normal bir yaşam döngüsünün kaydı **boş** bıraktığını doğrular.

## Tablolar

| Tablo | Ne tutar |
|---|---|
| `rulesets` | Sürümlenmiş kural setleri, fork soyağacıyla |
| `exchange_accounts` | Şifrelenmiş borsa kimlik bilgileri |
| `bots` | Yapılandırılmış çalıştırıcılar ve container durumu |
| `bot_events` | Bir botun kendiliğinden düşmesi, dönmesi, toparlanması |
| `backtests` | Backtest koşuları, vitrin metrikleri ayrı sütunlarda |
| `trades` | Freqtrade'den aynalanan kapanmış işlemler |

## Veritabanı seviyesindeki güvenceler

Uygulama katmanı hata yapsa bile veritabanının izin vermediği şeyler:

| Kısıt | Ne engeller |
|---|---|
| `bots_live_requires_account` | Kimlik bilgisi olmadan gerçek parayla çalışan bot |
| `bots_stake_positive` | Sıfır ya da negatif pozisyon büyüklüğü |
| `bots_max_open_trades_positive` | Sıfır eşzamanlı işlem limiti |
| `trades_bot_ft_id_idx` | Senkronizasyonun aynı işlemi iki kez yazması |
| `rulesets_slug_version_idx` | Aynı sürümün iki kez kaydedilmesi |

`PRAGMA foreign_keys = ON` bağlantı açılırken **açıkça** ayarlanır — SQLite'ta
varsayılan kapalıdır ve unutulursa şemadaki bütün referanslar sessizce hiçbir
şey yapmaz. Testlerden biri doğrudan bunu doğrular.

## Kimlik bilgileri

`exchange_accounts` içinde **düz metin sütunu yoktur**. Anahtarlar envelope
encryption ile şifreli saklanır; yazılır ve değiştirilir, asla geri okunmaz.

`withdrawal_disabled`, anahtar bağlanırken borsaya sorulup doğrulanır. Çekim
izni açık bir anahtar kabul edilmez.

## Metrikler

`backtests` tablosunda vitrin metrikleri ayrı sütunlarda tutulur, böylece
listeleme ve sıralama tam sonucu ayrıştırmadan yapılabilir.

`win_rate` saklanır ama **sıralamada varsayılan değildir.** Bu repodaki ölçümde
%82.4 kazanma oranıyla %11.57 kaybeden bir strateji görüldü; kazanma oranı
kullanıcıyı en çok yanıltacak metriktir. Öne çıkan sıralama `profit_factor`,
`expectancy` ve `max_drawdown` üzerinden yapılmalıdır.

`market_change` aynı dönemde piyasanın ne yaptığını tutar — kıyas olmadan
getiri sayısı anlamsızdır.

## Kullanım

```ts
import { createDatabase, rulesets } from "@rudder/db";

const db = createDatabase({ source: "./rudder.db" });
const all = db.select().from(rulesets).all();
```

## Migration

Şema değiştikten sonra:

```sh
pnpm --filter @rudder/db generate
```

`migrations/` altındaki SQL dosyaları sürüm kontrolüne girer, elle düzenlenmez.

## Geliştirme

```sh
pnpm --filter @rudder/db test
pnpm --filter @rudder/db typecheck
```

Testler bellek içi veritabanı kullanır ve her testte migration'ları sıfırdan
uygular — yani migration'lar da test edilmiş olur.

## Bilinen borç

Node'un yerleşik `node:sqlite` modülü bu iş için daha uygun olurdu: native
bağımlılık gerekmez, kurulum deneyimi sadeleşir. Ancak Drizzle desteği yalnızca
1.0 release candidate hattında. Drizzle 1.0 kararlıya çıktığında
`better-sqlite3` bağımlılığı kaldırılabilir.
