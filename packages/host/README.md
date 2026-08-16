# @rudder/host

Rudder'ın üzerinde koştuğu makine: container çalışma zamanı ve disk yerleşimi.

Kendi başına hiçbir iş yapmaz. Burada olmasının sebebi iki tüketicisinin
olması — [`@rudder/orchestrator`](../orchestrator) (botlar) ve
[`@rudder/backtest`](../backtest) — ve birinin diğerinin içinden geçmesinin
yanlış bir bağımlılık yönü doğurması.

## Disk yerleşimi

```
<dataRoot>/
  rudder.db          veritabanı (RUDDER_DB ile ayrıca değiştirilebilir)
  bots/<botId>/      @rudder/orchestrator
  backtests/<id>/    @rudder/backtest
  market-data/       @rudder/backtest — mum verisi, testler arasında paylaşılır
```

Varsayılan kök `~/.rudder`, `RUDDER_DATA_DIR` ile değiştirilir.

### Neden ev dizini, neden OS temp değil

macOS'ta `os.tmpdir()` `/var/folders` altındadır ve Colima (ile Docker Desktop)
bu yolu sanal makineye paylaşmaz. Docker paylaşılmayan bir yolu mount ederken
**hata vermez** — sessizce bir dizin oluşturur — ve container içinde
anlaşılmaz bir `IsADirectoryError` çıkar.

Container'a mount edilen hiçbir şey OS temp'inde olamaz; entegrasyon testleri
de dahil.

## Docker

CLI kullanılıyor, HTTP API değil: bağımlılık yok, çıktısı okunabilir,
kullanıcının zaten bildiği arayüz, Docker Desktop / Colima / Podman arasında
taşınabilir. Bu ölçekte süreç başlatma maliyeti önemsiz.

| | |
|---|---|
| `runContainer` | Uzun ömürlü, `--detach` + `--restart` (botlar) |
| `runOnce` | Tek seferlik iş, ön planda, çıktıyı döndürür (backtest) |
| `inspectContainer` / `stopContainer` / `removeContainer` / `containerLogs` | |
| `listContainers(label)` | Yetim container bulmak için |

### Sırlar komut satırına yazılmaz

`docker run -e KEY=VALUE` değeri argv'ye koyar ve aynı makinedeki başka
kullanıcılar `ps` ile görebilir. Bunun yerine değersiz `-e KEY` biçimi
kullanılır: Docker CLI değeri kendi ortamından okur, biz de onu alt sürecin
ortamına koyarız.

### `--rm` tek başına yetmez

`--rm` yalnızca container **kendi** durduğunda temizler. Docker CLI'ını
öldürmek container'ı öldürmez, ve arkada kalan container adı bir sonraki
denemeyi isim çakışmasıyla düşürür. `runOnce` bu yüzden zaman aşımında ve
hatada container'ı açıkça kaldırır, başlarken de aynı adlı kalıntıyı siler.

### `inspectContainer` yeniden başlatma sayacını da okur

`--restart unless-stopped` ile başlatılan bir container çöktüğünde Docker onu
geri getiriyor. Sorun şu ki bu sırada container **çalışıyor görünüyor.**
Ölçüldü — saniyede bir çöken bir container, iki saniyede bir örneklendiğinde:

```
running=true   status=running     exit=0   restarts=1
running=true   status=running     exit=0   restarts=3
running=true   status=running     exit=0   restarts=4
running=true   status=restarting  exit=1   restarts=5
running=true   status=restarting  exit=1   restarts=6
```

`running` hiçbir örneklemede false olmuyor ve `exitCode` örnekleme anına göre
değişiyor. Ayırt eden iki alan `status` (`restarting`) ve **monoton artan**
`RestartCount`; ikincisi eskiden hiç okunmuyordu.

`ContainerState` ham kalır — bunun ne anlama geldiğine
[`@rudder/orchestrator`](../orchestrator/README.md) karar verir. Ayrıştırma
`parseInspect` olarak ayrıldı ki Docker olmadan test edilebilsin; format
dizesindeki alan sırası ile ayrıştırmadaki sıra elle eşleşiyor ve kayan bir
alan sessizce yanlış değeri okur.

### Çıktı sınırı

`runOnce` alt sürecin çıktı tamponunu 32 MB'a çıkarır. Node'un 1 MB'lık
varsayılanı aşıldığında süreç **öldürülür**, yani sınır çalışan bir backtest'i
keserek fark edilir.
