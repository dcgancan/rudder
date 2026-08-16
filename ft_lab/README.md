# ft_lab — Freqtrade keşif ortamı

Ürün kararı öncesi Freqtrade'i gerçek veriyle denemek için kurulan tek kullanımlık
laboratuvar. Üretim yapısı değil.

Doğrulanan sürüm: **Freqtrade 2026.7 / CCXT 4.5.68 / linux-arm64 native**

## Çalıştırma

Tüm komutlar repo kökünden çalıştırılır. Docker (Colima) gerekir; `docker compose`
gerekmez.

### 1. Backtest

```sh
docker run --rm -v "$(pwd)/ft_lab/user_data:/freqtrade/user_data" \
  freqtradeorg/freqtrade:stable \
  backtesting --config /freqtrade/user_data/config.json \
  --strategy SampleStrategy --timerange 20260201- --export trades --cache none
```

Sonuç `user_data/backtest_results/*.zip` içine yazılır. Zip'in içindeki
`*.json` dosyasında strateji başına **118 metrik**, `trades[]`, `daily_profit[]`,
`results_per_pair[]` ve `exit_reason_summary[]` bulunur.

### 2. Veri indirme

```sh
docker run --rm -v "$(pwd)/ft_lab/user_data:/freqtrade/user_data" \
  freqtradeorg/freqtrade:stable \
  download-data --config /freqtrade/user_data/config.json \
  --timerange 20260201- --timeframes 5m 1h
```

### 3. Canlı dry-run + REST API

```sh
docker run -d --name ftlab -p 8080:8080 \
  -v "$(pwd)/ft_lab/user_data:/freqtrade/user_data" \
  freqtradeorg/freqtrade:stable \
  trade --config /freqtrade/user_data/config.json --strategy SampleStrategy
```

Durdurma: `docker rm -f ftlab`

### 4. API'ye erişim

```sh
ACCESS=$(curl -s -X POST -u ftlab:ftlab_dev_password \
  http://127.0.0.1:8080/api/v1/token/login | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

curl -s -H "Authorization: Bearer $ACCESS" http://127.0.0.1:8080/api/v1/status
```

Swagger arayüzü: <http://127.0.0.1:8080/docs> (72 endpoint)

### 5. WebSocket

```sh
node ft_lab/ws_probe.mjs
```

## Ortamdaki kimlik bilgileri

`config.json` sürüm kontrolüne **girmez**; `config.example.json` kopyalanarak
oluşturulur:

```sh
cp ft_lab/user_data/config.example.json ft_lab/user_data/config.json
```

İçindeki kullanıcı adı, parola, `jwt_secret_key` ve `ws_token` **sadece lokal
geliştirme içindir**. Gerçek kullanımda her instance için rastgele üretilmelidir.

## Notlar

- `dry_run: true` — gerçek emir gönderilmez, borsa API anahtarı gerekmez.
- `/strategies` ve backtest endpoint'leri `trade` modunda **çalışmaz**;
  ayrı bir `webserver` modu instance'ı gerektirir.
- `force_exit` varsayılanı **limit** emirdir, anında dolmaz. Arayüzde
  "hemen sat" davranışı isteniyorsa `order_types.force_exit: "market"` gerekir.
