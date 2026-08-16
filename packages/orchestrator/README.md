# @rudder/orchestrator

Bot satırlarını çalışan Freqtrade container'larına çevirir ve geri okur.

## Sorumluluk

| | |
|---|---|
| `start` / `stop` / `remove` | Container yaşam döngüsü ve bot dizinleri |
| `refreshStatus` | Satırdaki durumu gerçeğe eşitler |
| `client` | O botun tipli API istemcisi |
| `syncTrades` | Kapanmış işlemleri veritabanına aynalar |

## Kararlar

### API kimlik bilgileri veritabanında tutulmaz

Freqtrade bunları zaten `config.json`'da görmek zorunda. İkinci bir kopya
çıkarmak koruma alanını genişletmekten başka işe yaramaz. Bir botla konuşmak
gerektiğinde kimlik bilgileri o botun config dosyasından okunur.

Config dosyası `0600`, bot dizini `0700` ile yazılır. Bir test bunu doğrular.

### `start()` beklemez

Freqtrade'in borsa piyasalarını yüklemesi birkaç saniye sürüyor; bir web
isteğini o kadar bekletmek doğru değil. `start()` container'ı oluşturur ve
durumu `starting` yapar. Hazır olduğunu görmek için `refreshStatus()` ya da
`waitUntilRunning()` kullanılır.

### Docker CLI, HTTP API değil

Bağımlılık yok, çıktısı okunabilir, kullanıcının zaten bildiği arayüz, Docker
Desktop / Colima / Podman arasında taşınabilir. Bu ölçekte (bir makinede
birkaç düzine bot) süreç başlatma maliyeti önemsiz.

### Sırlar komut satırına yazılmaz

`docker run -e KEY=VALUE` değeri argv'ye koyar ve aynı makinedeki başka
kullanıcılar `ps` ile görebilir. Bunun yerine değersiz `-e KEY` biçimi
kullanılır: Docker CLI değeri kendi ortamından okur, biz de onu alt sürecin
ortamına koyarız.

### Portlar yalnızca 127.0.0.1'e yayınlanır

Bot API'si makine dışından erişilebilir olmamalı. Her bota `17000-17999`
aralığından bir port atanır; veritabanında başka bota atanmış portlar atlanır
ve kalan aday gerçekten dinlenebiliyor mu diye denenir.

## Bot dizinleri OS temp'inde olamaz

macOS'ta `os.tmpdir()` `/var/folders` altındadır ve Colima (ile Docker Desktop)
bu yolu sanal makineye paylaşmaz. Docker paylaşılmayan bir yolu mount ederken
**hata vermez** — sessizce bir dizin oluşturur — ve container içinde
anlaşılmaz bir `IsADirectoryError` çıkar.

Varsayılan kök bu yüzden `~/.rudder`, ve `RUDDER_DATA_DIR` ile değiştirilebilir.

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

## Henüz yok

- **Live mod.** Borsa anahtarlarının şifresini çözmek gerekiyor;
  `packages/crypto` yazılana kadar `start()` yalnızca paper modu besliyor.
- **Uzlaştırma döngüsü.** Şu an durum yalnızca `refreshStatus()` çağrıldığında
  güncelleniyor. Yetim container'ları bulmak için `BOT_LABEL` etiketi ve
  `listContainers()` hazır, kullanan yok.
