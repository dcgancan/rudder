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
düşüş olmadı" diye okunur ve bu yalan olur. Üçüncü bir hal daha var: test
edilmiş ama hiç işlem açmamış bir kural setinin eğrisi tek noktadan ibaret
(`[0]`) ve alan yine boş kalıyor — başlık bu kez "hiç işlem açmadı" der.

Eğri çizim genişliğine indirgenirken her kovanın **en düşüğü** alınıyor.
Ortalama en derin çukuru yumuşatır, ve bu grafiğin tek işi o çukuru göstermek.

## Backtest

Strateji sayfasındaki tek soru **dönem**: son 3, 6 ya da 12 ay. Borsa, parite
listesi ve sermaye sabit; gerekçesi
[`packages/backtest/README.md`](../../packages/backtest/README.md)'de.

Form bir **sunucu eylemine** bağlı, tıklama işleyicisine değil. Ölçüldü:
hidrasyon tamamlanmadan basılan bir düğme, `onSubmit` ile formu düz GET olarak
gönderiyor ve hiçbir şey olmuyordu. Eylemin sonunda `redirect()` var — POST →
yönlendirme → GET. Yönlendirme olmadan tarayıcının son geçmiş kaydı bir POST
olarak kalıyor ve sayfanın her tazelenişi formu yeniden gönderiyor; tek
tıklamayla arka arkaya yedi backtest başladığı görüldü.

İstemci tarafındaki tek iş, çalışan bir testi `/api/backtests/<id>` üzerinden
üç saniyede bir sorup bitince sayfayı tazelemek.

Kuyruk sunucu açılışında kuruluyor (`src/instrumentation.ts`), ilk istekte
değil: kurtarma adımı bir kullanıcı isteğine bağlı olamaz — aksi halde önceki
sürecin bıraktığı işler kimse yeni bir test başlatana kadar hiç başlamıyor.

Her iki sayfa da `force-dynamic`. Derleme anında dondurulmuş bir sayfa sonsuza
kadar "test edilmedi" derdi.

### Sayıların sırası

Önce kâr faktörü, beklenen değer ve en sert düşüş; **kazanma oranı en sonda ve
vurgusuz**. Bu projenin kendi ölçümünde bir strateji işlemlerinin %82,4'ünü
kazanıp %11,57 kaybetti — kazanma oranını başa koymak insanı tam olarak o
yanılgıya götürüyor.

Kâr faktörü hiç kayıp yokken **tanımsızdır**; Freqtrade oraya `0` yazıyor ve
sıfır ekranda "berbat" diye okunur. Böyle bir durumda sayı yerine "ölçülemez"
yazılıyor.

Yüzdeler sabit bir ondalık basamakla yazılıyor: sütun tabular-nums ile
hizalanıyor ve "-%3" ile "-%11,8" yan yana geldiğinde ilki olduğundan kaba
görünüyor.

Çıkış sebepleri Freqtrade'in enum'undan geliyor ama motor, satış sinyaline
kural setinin id'sini etiket olarak koyuyor ve Freqtrade o etiketi çıkış sebebi
diye kaydediyor. Freqtrade'in kendi sebepleri dışındaki her değer, tanımı
gereği bizim satış kuralımızdır ve öyle çevrilir.

### Tipografi

| Rol | Yüz | Nerede |
|---|---|---|
| Etiket / başlık | Archivo | Büyük harf, geniş aralıklı harita etiketleri; strateji adları |
| Gövde | Source Serif 4 | Üretilmiş cümleler ve açıklamalar |
| Sayı | IBM Plex Mono | Yalnızca sayı ve kod |

Gövdenin serif olması bir karar: bu sayfanın işi **okutmak**, taratmak değil.

`latin-ext` alt kümesi Türkçe için zorunlu (ı, İ, ş, ğ, ç, ö, ü).

## Strateji yazmak

`/strategies/new` sıfırdan, `/strategies/[slug]/edit` var olandan. Form
modelinin neden iç içe koşul kabul etmediği ve indikatör id'lerini nasıl
ürettiği [`packages/ruleset/README.md`](../../packages/ruleset/README.md)'de.

### Önizleme katalogla aynı koddan geliyor

Editör `toRuleset` + `describe` çağırıyor — kataloğun çağırdığı iki fonksiyonun
aynısı, üstelik tarayıcıda. Açıklamanın kuraldan sapabileceği ikinci bir yol
yok; bu, projenin tek iddiasının yapısal garantisi.

### Düzenlemek yeni sürüm, çatallamak yeni strateji

Repoyla gelen bir stratejiyi kaydetmek kendi kopyanızı yaratır
(`forkedFromId` kaynağa bakar); kendi stratejinizi kaydetmek yeni bir sürüm.
Builtin'i yerinde sürümlemek olmaz: `seed.ts` o slug'ların sahibi.

Bu kararı **yalnızca sunucu** veriyor, kaynağın `source` alanına bakarak.
Formun `forking` bilgisi sadece metin için. Bir ara istemci de karar veriyordu
ve çatallanan stratejinin soyağacı sessizce kayboldu — aynı kararın iki yerde
verilmesinin bedeli.

### Geçersiz taslak

Kaydet düğmesi `validateRuleset()` geçene kadar pasif ve **sebebi yazılı**.
Düğme ayrıca hidrasyon tamamlanana kadar da pasif: taslak forma gizli bir JSON
alanı olarak giriyor ve erken bir tıklama, kullanıcının yazdığını değil
başlangıç taslağını kaydederdi.

### Kullanıcının verdiği adlar büyük harfe çevrilmez

`.label` sınıfı büyük harfe sayfanın diline göre çeviriyor. Türkçe bir strateji
adını İngilizce sayfada büyütmek noktaları düşürüyor ("Stratejisi" →
"STRATEJISI"). Büyük harf bizim kendi etiketlerimiz için; kullanıcı verisi
olduğu gibi görünür.

## Botlar

Bir stratejiyi çalıştırmak `/bots` altında iki ekran: liste ve detay. Kurarken
sorulan tek şey **ad**; borsa, pariteler ve sermaye ölçümün ayarlarını
devralıyor (`STANDARD_SETUP`), yani sayfadaki ölçüm gerçekten o botun ölçümü.

Ölçümü olmayan bir stratejiden de bot kurulabilir — uyarı görünür ama yol
kapanmaz. Kağıt üzerinde işlem risksiz; asıl kapı gerçek parada ve orası henüz
yok.

### Geri alınamaz işlemler `<details>` ile korunuyor

"Botu kaldır" ve "şimdi kapat" iki adımlı. Onay bir istemci bileşeniyle
alınsaydı, hidrasyon tamamlanmadan basılan düğme doğrudan gönderilirdi —
container ve dosyaları silen ya da zararı kesinleştiren bir işlemde kabul
edilemez. `<details>` JavaScript hiç çalışmasa da geçerli bir koruma.

### İki farklı tazeleme çözümü, iki farklı sebep

| | |
|---|---|
| Backtest | `/api/backtests/<id>` durum sorgusu, bitince `router.refresh()` |
| Botlar | Doğrudan `router.refresh()`, ayrı uç yok |

Backtest'te dakikalarca süren bir işte değişen tek şey bir durum alanı; bunun
için sayfanın tamamını yeniden çizmek israf. Botta pozisyonlar, cüzdan ve kâr
sürekli değişiyor — yani sayfanın kendisi zaten "yeni veri" demek ve ikinci bir
veri şekli çıkarmak aynı sayıları iki ayrı yerde biçimlendirmek olurdu.

### Bot adı çevrilmez

Ad kullanıcı verisi; varsayılanı kurulduğu dildeki strateji adından geliyor ama
sonrasında olduğu gibi kalıyor. İngilizce sayfada Türkçe bir bot adı görmek
doğru davranış — o adı kullanıcı verdi.

### "Olaylar" durumun söyleyemediğini söyler

Bot detayında, kapanmış işlemlerin altında. Durum alanı yalnızca **şu anı**
anlatabiliyor, ve bu bir botun sağlığı için yeterli değil: Docker çöken botu
geri getirdiği için, gece üç kez düşmüş bir bot sabah "çalışıyor" görünüyor.
Olay listesi o geçmişi tutuyor.

Yalnızca kullanıcının **istemediği** şeyler yazılıyor — çöktü, kendiliğinden
durdu, kendiliğinden yeniden başladı, tekrar çalışmaya başladı. Botu durdurmak
listeye girmez; kullanıcının kendi yaptığı şeyi ona geri anlatmanın anlamı yok.
Sağlıklı bir bot bu bölümde tek satır göstermez, ve bu bir eksiklik değil,
listenin okunur kalmasının sebebi.

Renk kuralı korunuyor: yalnızca "Çöktü" uyarı renginde. Bir botun geri gelmesi
kutlanacak bir şey değil, sadece bir durum — kâr için renk kullanmama kuralının
aynısı. Zaman `format.dateTime` ile; Freqtrade'in hazır İngilizce dizgeleri
hiçbir yerde ekrana basılmıyor.

Arka planda dönen döngünün kendisi arayüzde değil
([`@rudder/orchestrator`](../../packages/orchestrator/README.md)); buradaki tek
iş onu süreç başına bir kez ayağa kaldırmak, uzlaştırma ile aynı `globalThis`
önbelleğinde.

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

- Kural setini dosya olarak dışa/içe aktarma
- Borsa hesabı bağlama ve gerçek parayla işlem
- Bot ayarlarını sonradan değiştirme
- Backtest'in açtığı işlemlerin listesi (veri diskteki zip'te duruyor)
- Çalışan bir testi iptal etme
