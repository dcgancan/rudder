# @rudder/freqtrade

Freqtrade'i bilen tek katman: yapılandırma üretimi ve tipli REST istemcisi.
Bu paketin dışında hiçbir yer Freqtrade'in config şemasını ya da uç noktalarını
bilmek zorunda değil.

## Standart kurulum

`STANDARD_SETUP`, bir stratejinin hem **ölçüldüğü** hem **çalıştırıldığı**
ayarlar: borsa, pariteler, cüzdan, pozisyon büyüklüğü, en fazla açık işlem.

Burada durmasının sebebi kolaylık değil, doğruluk. `@rudder/backtest` ve
`@rudder/orchestrator` aynı sabiti kullanıyor, yani bir botun ayarları ölçümün
ayarlarından sapamıyor ve kullanıcının ekranda gördüğü sayı gerçekten o botun
sayısı oluyor. Sabit iki pakete kopyalansaydı "aynı ayarlar" bir tesadüf
olurdu; iki tüketicinin de bağımlı olduğu bu paket, tek doğal ev.

Kullanıcıya sorulmaz: sormak, ürünün kaçınmaya çalıştığı Freqtrade yüzeyini
geri getirir ve her strateji farklı sermayeyle ölçülürse sonuçlar birbiriyle
kıyaslanamaz.

## İki değişmez

### 1. Sırlar dosyaya yazılmaz

Borsa anahtarları config.json'a girmez; `FREQTRADE__EXCHANGE__KEY` ve
`FREQTRADE__EXCHANGE__SECRET` ortam değişkenleriyle geçirilir.

Sonuç: üretilen config güvenle diske yazılabilir, loglanabilir, kullanıcıya
gösterilebilir. `buildSecretEnv()` çıktısı ise sır içerir ve loglanmamalıdır.

### 2. Config kural setini ezemez

Freqtrade'de config değerleri strateji niteliklerinden üstündür. `stoploss`,
`timeframe`, `minimal_roi` gibi bir anahtar yanlışlıkla config'e girerse **bot
kural setinin risk ayarlarını sessizce yok sayar** ve hiçbir yerde hata çıkmaz.

`buildConfig()` ürettiği nesneyi `RULESET_OWNED_KEYS` listesine karşı denetler
ve ihlalde fırlatır. Entegrasyon testi de aynı şeyi çalışan bir bota sorarak
doğrular: `show_config` dönen `timeframe` ve `stoploss` değerleri kural
setindekilerle birebir eşleşmeli.

**Ne nereye ait:**

| Kural seti (strateji) | Bot (config) |
|---|---|
| `timeframe`, `stoploss`, `minimal_roi` | `max_open_trades`, `stake_amount` |
| `trailing_*`, `order_types` | `stake_currency`, `pair_whitelist` |
| `use_exit_signal` | `dry_run`, borsa, API sunucusu |

## Kullanım

```ts
import {
  buildCommand, buildConfig, buildSecretEnv,
  generateApiCredentials, FreqtradeClient,
} from "@rudder/freqtrade";

const api = generateApiCredentials(8080);
const config = buildConfig(botSpec, api);          // diske yazılabilir
const env = buildSecretEnv({ exchangeKey, exchangeSecret });  // yazılamaz

// container ayağa kalktıktan sonra
const client = new FreqtradeClient({
  baseUrl: "http://127.0.0.1:18080",
  username: api.username,
  password: api.password,
});

await client.status();
await client.forceExit("all");
```

İstemci jetonu kendi yönetir: yoksa giriş yapar, 401'de refresh jetonuyla bir
kez yeniler, o da olmazsa baştan giriş yapar.

## Container yerleşimi

`CONTAINER_PATHS` mount'ların nereye geleceğini tanımlar:

| Host | Container | Mod |
|---|---|---|
| `<bot>/config.json` | `/freqtrade/user_data/config.json` | ro |
| `<bot>/ruleset.json` | `/freqtrade/ruleset.json` | ro |
| `engine/` | `/freqtrade/engine` | ro |

API portu **yalnızca `127.0.0.1`'e yayınlanır**. Config içinde
`listen_ip_address: "0.0.0.0"` yazması zorunludur (yoksa yayınlanan port
çalışmaz); dışarı açılmamasını sağlamak orchestrator'ın işidir.

## Bot dizinleri OS temp'inde olamaz

Doğrulanmış kısıt: macOS'ta `os.tmpdir()` `/var/folders` altındadır ve Colima
(ve Docker Desktop) bu yolu sanal makineye paylaşmaz. Docker, paylaşılmayan bir
kaynağı mount ederken **hata vermez** — sessizce bir dizin oluşturur. Sonuç
container içinde `IsADirectoryError` olur ve sebebi hiçbir yerde görünmez.

Bot çalışma dizinleri kullanıcının ev dizini altında yapılandırılabilir bir
kökte tutulmalıdır. `/Users` altındaki yollar paylaşılıyor, doğrulandı.

## Testler

```sh
pnpm --filter @rudder/freqtrade test
```

Birim testleri bağımlılıksız çalışır. Entegrasyon testleri Docker gerektirir ve
varsayılan olarak atlanır:

```sh
RUDDER_INTEGRATION=1 pnpm --filter @rudder/freqtrade test
```

Gerçek bir container ayağa kaldırır (~9 saniye), kural setinin uygulandığını
doğrular, pozisyon açıp kapatır ve temizler. Borsa anahtarı gerekmez — paper
modda çalışır.
