# @rudder/orchestrator

Bot satırlarını çalışan Freqtrade container'larına çevirir ve geri okur.

## Sorumluluk

| | |
|---|---|
| `create` | Bot satırını yazar (container başlatmaz) |
| `start` / `stop` / `remove` | Container yaşam döngüsü ve bot dizinleri |
| `refreshStatus` | Satırdaki durumu gerçeğe eşitler ve değişimi kayda geçer |
| `reconcile` | Bütün botları gerçeğe eşitler, yetim container'ları kaldırır |
| `Watchdog` | Aynısını kimse bakmasa da yapar |
| `client` | O botun tipli API istemcisi |
| `syncTrades` | Kapanmış işlemleri veritabanına aynalar |

## Kararlar

### API kimlik bilgileri veritabanında tutulmaz

Freqtrade bunları zaten `config.json`'da görmek zorunda. İkinci bir kopya
çıkarmak koruma alanını genişletmekten başka işe yaramaz. Bir botla konuşmak
gerektiğinde kimlik bilgileri o botun config dosyasından okunur.

Config dosyası `0600`, bot dizini `0700` ile yazılır. Bir test bunu doğrular.

### Bot, stratejinin ölçüldüğü ayarlarla kurulur

`create()` bütün ayarları `STANDARD_SETUP`'tan alır ve kullanıcıya yalnızca ad
sorulur. Gerekçesi [`@rudder/freqtrade`](../freqtrade/README.md)'de: ayarları
sabit tutmak, ekranda görünen ölçümün gerçekten o botun ölçümü olmasını
sağlıyor.

Mod her zaman `paper`. Gerçek parayla işlem borsa anahtarlarının şifresini
çözmeyi gerektiriyor ve `packages/crypto` yazılmadı.

### Durdurulan bir bot hata değildir

`refreshStatus()` sıfırdan farklı bir çıkış kodunu çökme sayıyordu. Ölçüldü:
`docker stop` sonrası Freqtrade container'ı **130** ile çıkıyor, yani kullanıcı
botu kendi durdurduğunda arayüzde "HATA" görüyordu.

Kural artık şu: **128 ve üstü çıkış kodu sonlandırılma demek, çökme değil**
(POSIX'te 128 + sinyal). Gerçek çökmeler — Python hatası 1, hatalı argüman 2 —
hâlâ hata olarak görünür. Kabul edilen bedel, bellek yetersizliğinden
öldürülen bir botun (137) "durdu" görünmesi; en sık yaşanan yolu yanlış
işaretlemekten iyi.

### Çöküp duran bir bot "açılıyor" değildir

Botlar `--restart unless-stopped` ile başlatılıyor, yani çöken bir botu Docker
geri getiriyor. Bu sırada container **çalışıyor görünüyor** — ölçüm
[`@rudder/host`](../host/README.md)'ta. Sonuç: sürekli çöken bir bot
`running=true` veriyor, API cevap vermiyor, ve eski kural onu `starting`
yazıyordu. **Arayüzde çöküp duran bot sonsuza kadar "Açılıyor" görünüyordu**,
"Hata" değil.

Kural artık şu: **`restarting` durumu çökmedir.** Sağlıklı bir açılışta bu değer
hiç görülmüyor; container `created`'dan doğrudan `running`'e geçiyor. Çıkış
koduna güvenmek işe yaramıyor, çünkü örnekleme anına göre 0 ya da 1 dönüyor.

### Sınıflandırma saf, ayrı bir dosyada

`health.ts` bir gözlemi (container hali + API cevap veriyor mu) bot durumuna
çevirir ve ne Docker'a ne veritabanına dokunur. `refreshStatus()` yalnızca
gözlemi toplar ve sonucu yazar.

Sebep: bu kuralların yanlış olması ekranda görünen her durumu yanlış yapıyor ve
bunu container başlatmadan doğrulayabilmek gerekiyor. Kuyruğun
`BacktestExecutor` dar arayüzüyle aynı gerekçe.

| Gözlem | Durum |
|---|---|
| container yok | `stopped` |
| `status = restarting` | `error` |
| çalışmıyor, çıkış kodu 0 < n < 128 | `error` |
| çalışmıyor, sinyal ya da temiz çıkış | `stopped` |
| çalışıyor, API sessiz | `starting` |
| çalışıyor, API cevap veriyor | `running` |

### `start()` beklemez

Freqtrade'in borsa piyasalarını yüklemesi birkaç saniye sürüyor; bir web
isteğini o kadar bekletmek doğru değil. `start()` container'ı oluşturur ve
durumu `starting` yapar. Hazır olduğunu görmek için `refreshStatus()` ya da
`waitUntilRunning()` kullanılır.

### Docker CLI, HTTP API değil

Container çalışma zamanı ve `~/.rudder` yerleşimi [`@rudder/host`](../host)'ta;
gerekçeleri (CLI tercihi, sırların argv'ye yazılmaması, portların yalnızca
127.0.0.1'e yayınlanması, OS temp'in neden kullanılamayacağı) orada
belgelenmiştir. Orchestrator o katmanın tüketicisidir.

### Portlar yalnızca 127.0.0.1'e yayınlanır

Bot API'si makine dışından erişilebilir olmamalı. Her bota `17000-17999`
aralığından bir port atanır; veritabanında başka bota atanmış portlar atlanır
ve kalan aday gerçekten dinlenebiliyor mu diye denenir.

## Bot dizinleri

```
<dataRoot>/bots/<botId>/
  ruleset.json            → /freqtrade/ruleset.json      (ro)
  user_data/
    config.json           → /freqtrade/user_data          (rw)
```

`user_data` rw mount edilir çünkü Freqtrade veritabanını ve loglarını oraya
yazar; bot yeniden başlatıldığında geçmişi korunur.

## Kullanım

```ts
const orchestrator = new Orchestrator({ db });

await orchestrator.start(botId);
await orchestrator.waitUntilRunning(botId);

const client = await orchestrator.client(botId);
await client.forceExit("all");

await orchestrator.syncTrades(botId);
await orchestrator.stop(botId);
```

## Testler

```sh
pnpm --filter @rudder/orchestrator test
RUDDER_INTEGRATION=1 pnpm --filter @rudder/orchestrator test
```

Entegrasyon testi zincirin tamamını gerçek Docker ile doğrular: veritabanı
satırı → container → çalışan bot → senkronize edilmiş işlem geçmişi → durdurma
→ yeniden başlatma → kaldırma. Borsa anahtarı gerekmez, paper modda çalışır.

### Uzlaştırma açılışta yapılır

Durum yalnızca sorulduğunda güncelleniyor, yani süreç ölüp geri geldiğinde
satırlar son bilinen hallerinde kalıyor: makine yeniden başlamışsa `running`
yazan bir botun container'ı çoktan gitmiş olabilir. Durum artık ekranda
göründüğü için bu, kullanıcıya gösterilen bir yalan.

`reconcile()` bütün botları gerçeğe eşitler ve `BOT_LABEL` etiketli sahipsiz
container'ları kaldırır. Hiçbir botu başlatmaz ya da durdurmaz — yalnızca ne
olduğunu yazar. Arayüz bunu açılışta bir kez çağırıyor
(`apps/web/src/instrumentation.ts`); ölçüldü, uygulama kapalıyken durdurulan
bir container'ın satırı aksi halde "çalışıyor" kalıyor.

## Gözcü

Uzlaştırma açılışta, tazeleme sayfa okunduğunda çalışıyordu. Arada kalan
zamanda bir bot düşerse kimse fark etmiyordu. `Watchdog` o boşluğu kapatıyor:
`stopped` olmayan her botu düzenli aralıklarla `refreshStatus()`'ten geçirir.

**Karar vermez.** Ne çöküp duran bir botu durdurur, ne düşen bir botu başlatır.
`reconcile()` için yazılmış ilkenin aynısı — ne olduğunu yazar, kullanıcının
yerine geçmez.

Sınıflandırma ve olay kaydı gözcüde DEĞİL, `refreshStatus()` içinde. Sayfa
okuması da aynı yolu kullanıyor; ikinci bir yerde karar vermek aynı geçişin iki
farklı sonuç vermesi demek olurdu. Gözcünün tek işi kalp atışı.

### Aralıklar

| | | |
|---|---|---|
| Durum | 15 sn | bir `docker inspect` **12,4 ms** (20 çağrının ortalaması, Colima) |
| İşlem aynalama | 5 dk | bot başına, ve yalnızca `running` iken |

On botluk bir tur ~124 ms sürüyor, yani on beş saniyede bir çalışınca makinenin
%1'inden azı. Daha sık yoklamanın kazandıracağı bir şey yok: arayüz zaten 5-10
saniyede bir kendini tazeliyor, yani kullanıcı bakarken bu döngü belirleyici
değil. Gözcünün varlık sebebi kimsenin bakmadığı zaman.

İşlem aynalaması ayrı ve çok daha seyrek, çünkü farklı bir sorunu çözüyor: bir
**veri kaybı** penceresini. Kapanmış işlemler bugüne kadar yalnızca sayfa
okunduğunda aynalanıyordu ve `remove()` botun Freqtrade veritabanını siliyor —
yani hiç bakılmadan kaldırılan bir botun geçmişi yok oluyordu. Beş dakika o
pencereyi kapatmaya yetiyor. Daha sık çağırmanın anlamı yok: ölçüldü, 6
kapanmış işlem 16,6 KB ve 5,1 ms; yük işlem başına ~2,8 KB büyüyor, yani 500
işlem sınırındaki bir bot her seferinde bir megabaytın üstünü yeniden
gönderiyor — hem de değişmemiş bir listeyi.

### Olay kaydı

`bot_events`, kullanıcının **istemediği** şeyleri tutar: `failed`, `stopped`,
`restarted`, `recovered`. Botu durdurmak olay değildir; niyetin kaydı satırın
kendisinde, çünkü `stop()` önce `stopping` yazıyor.

Neden ayrı bir tablo, gerekçesi [`@rudder/db`](../db/README.md)'de: Docker
çöken botu geri getiriyor, yani tek bir "son hata" sütunu bir sonraki başarılı
açılışta siliniyor ve gece yaşanan çökme yok oluyor.

Kararın üçüncü girdisi **son kaydedilen olay**, ve bunu ölçüm öğretti. İki
yoklamayı karşılaştırmak yetmiyor: çöküp duran bir botun durumu arada bir an
`starting` görünüyor, ve yalnızca bir önceki yoklamaya bakan kural bunu "çökme
bitti, yeni bir çökme başladı" diye okuyor. Gerçek koşuda tek bir crash loop
önce üç, sonra iki satır yazdı; doğrusu bir. Aynı kusur toparlanmayı da yanlış
adlandırdı — `recovered` yerine `restarted`.

Bir "epizot" son kaydedilen olayla tanımlanıyor: bot düştü olarak yazıldıysa,
tekrar çalışana kadar düşmüş sayılır. Ölçülen dizilerin üçü de
`test/health.test.ts`'te birer test.

### Bilinen sınır

Çöküp duran bir bot ilk yoklamada `starting` görünebiliyor: Docker'ın geri
çekilme aralığı kısayken container `restarting` yerine `running` yakalanıyor.
Bir sonraki yoklamada düzeliyor, yani en fazla bir tık gecikme. Sayacı
sınıflandırmaya da katmak bunu anında yakalardı, ama makine yeniden
başladığında sağlıklı dönen bir bota kalıcı bir "Çöktü" satırı yazardı; on beş
saniyelik gecikme, yanlış bir kayıttan iyi.

## Henüz yok

- **Live mod.** Borsa anahtarlarının şifresini çözmek gerekiyor;
  `packages/crypto` yazılana kadar `start()` yalnızca paper modu besliyor.
- **Bildirim.** Gözcü bir botun düştüğünü yazıyor, ama kimseye haber vermiyor.
  Kullanıcı hâlâ bakmak zorunda; yalnızca artık bakınca doğrusunu görüyor.
