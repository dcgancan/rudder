# @rudder/web

Arayüz. Next.js (App Router) + Tailwind v4 + next-intl.

## Çalıştırma

```sh
pnpm --filter @rudder/web seed    # migration + hazır kural setleri
pnpm --filter @rudder/web dev
```

Veritabanı yolu `RUDDER_DB` ile, veri kökü `RUDDER_DATA_DIR` ile değiştirilir;
varsayılan `~/.rudder/rudder.db`.

## Görsel yön: deniz haritası

Bu ürün trading terminali olmamak üzerine kurulu. Bir deniz haritası sakin,
seyrek ve otoriterdir; nereye gitmen gerektiğini söylemez, orada ne olduğunu
söyler. Ürünün duruşu da bu.

### Kâr için renk yok

Kripto arayüzlerinin tamamı yeşil/kırmızı sayı üzerine kurulu, ve bu insanları
kazanma oranı gibi yanıltıcı metriklere bağlıyor. Burada kazanç nötr mürekkep
renginde; yalnızca kayıp ve risk `--color-alert` ile işaretlenir.

**Kâr kutlanmaz, risk işaretlenir.** Bu, projenin kendi ölçümünün doğrudan
görsel karşılığı: %82.4 kazanma oranıyla %11.57 kaybeden bir strateji.

### İmza öğesi: underwater eğrisi

Strateji kartlarında yükselen getiri grafiği yerine **drawdown** çizilir —
stratejinin kendi zirvesinin ne kadar altında kaldığı. Her zaman sıfırın
altındadır, yani pazarlama malzemesine dönüşemez; ve yeni başlayan biri için en
karar verdirici sayı budur.

Deniz haritasındaki derinlik konturuna benzemesi tesadüf değil: bu düşüşün
İngilizcedeki adı zaten *underwater*.

Çizim bir **ölçüm alanı** olarak kurulur: üstte datum çizgisi (zirve, 0), altta
ölçüm tabanı. Test edilmemiş bir strateji bu alanı boş bırakır. Boş bir ölçüm
alanı "ölçülmedi" der; başıboş bir çizgi hiçbir şey demez.

`drawdown: null` kasıtlıdır — boş dizi ya da sıfır değil. İkisi de "test edildi,
düşüş olmadı" diye okunur ve bu yalan olur.

### Tipografi

| Rol | Yüz | Nerede |
|---|---|---|
| Etiket / başlık | Archivo | Büyük harf, geniş aralıklı harita etiketleri; strateji adları |
| Gövde | Source Serif 4 | Üretilmiş cümleler ve açıklamalar |
| Sayı | IBM Plex Mono | Yalnızca sayı ve kod |

Gövdenin serif olması bir karar: bu sayfanın işi **okutmak**, taratmak değil.

`latin-ext` alt kümesi Türkçe için zorunlu (ı, İ, ş, ğ, ç, ö, ü).

## Metin

Sayfadaki hiçbir strateji cümlesi elle yazılmadı. Hepsi kural setinin yapısından
`@rudder/ruleset` ile üretiliyor, bu yüzden mantıktan sapamazlar ve yeni bir dil
eklemek bir locale dosyası yazmak demek.

Hero da gerçek içerik: veritabanındaki stratejilerden **en kısa cümleli** olan.
Alfabetik ilk sıradaki tesadüfen uzun olabilir, ve ilk izlenim "okunabilir"
iddiasının kendisi.

## Uyarılar dipnot değil

"Sayıları okumadan önce" bloğu sayfanın parçası ve somut: soyut bir
"risklidir" cümlesi yerine ölçülmüş bir örnek veriyor.

## Henüz yok

- Bot oluşturma ve yönetme ekranları
- Backtest tetikleme (bu yüzden her eğri "test edilmedi" durumunda)
- Borsa hesabı bağlama
