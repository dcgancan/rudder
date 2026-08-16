# @rudder/orchestrator

Bot satırlarını çalışan Freqtrade container'larına çevirir ve geri okur.

## Sorumluluk

| | |
|---|---|
| `create` | Bot satırını yazar (container başlatmaz) |
| `start` / `stop` / `remove` | Container yaşam döngüsü ve bot dizinleri |
| `refreshStatus` | Satırdaki durumu gerçeğe eşitler |
| `reconcile` | Bütün botları gerçeğe eşitler, yetim container'ları kaldırır |
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

## Henüz yok

- **Live mod.** Borsa anahtarlarının şifresini çözmek gerekiyor;
  `packages/crypto` yazılana kadar `start()` yalnızca paper modu besliyor.
- **Sürekli izleme.** Uzlaştırma açılışta ve sayfa okundukça yapılıyor; arka
  planda dönen bir döngü yok.
