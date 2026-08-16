# @rudder/ruleset

Kural seti şeması, doğrulaması ve sade dil render'ı. Ürünün çekirdek domain
paketi — hem web arayüzü hem orchestrator buradan besleniyor.

Node'un native TypeScript desteğiyle çalışır: **build adımı yok**, `.ts`
dosyaları doğrudan çalıştırılır. Node ≥ 22.18 gerekir.

## Kullanım

```ts
import { validateRuleset, describe, loadLocale, toText } from "@rudder/ruleset";

const result = validateRuleset(untrustedInput);
if (!result.ok) {
  // result.errors: { path, message }[]
  return;
}

const description = describe(result.ruleset, await loadLocale("tr"), "tr");
console.log(toText(description));
```

`describe()` yapısal bir nesne döndürür — arayüz bunu bileşen olarak render
eder. `toText()` yalnızca CLI ve testler içindir.

## CLI

```sh
pnpm describe rulesets/bb-bounce.json tr
```

Kural setini önce doğrular, sonra açıklamasını basar.

## Doğrulama iki tür kontrol yapar

**Yapısal** (Zod tipleri) — bilinmeyen fonksiyon, operatör veya alan.

**Anlamsal** (`superRefine`) — tek başına tiplerle yakalanamayan, asıl saldırı
yüzeyinin bulunduğu yer:

- indikatör id'si OHLCV sütununu gölgeliyor mu
- aynı id iki kez tanımlanmış mı
- bir operand tanımsız bir şeye referans veriyor mu
- tek çıktılı indikatörde `period` var mı
- çok çıktılı indikatörde (`macd`, `bbands`) `output` açıkça verilmiş mi
- `trailing.enabled` iken `trailing.positive` var mı

Son ikisi güvenlik değil, sessiz sürpriz önlemidir: `bbands` varsayılana
düşerse kullanıcı yazdığını sandığından farklı bir strateji çalıştırır, ve
`positive` olmadan trailing açık bırakılırsa hata bot ayağa kalkarken çıkar.

## Taslak: formun düzenlediği model

`compose.ts` kural seti ile arayüz formu arasındaki çevrimi yapıyor. Kural
setinin kendisi bir form için fazla serbest ve iki şeyi kaldırıyor:

**Tek seviye.** Şema iç içe `all`/`any`/`not` ağaçlarına izin veriyor; taslak
vermiyor. Bir kural, "hepsi" ya da "herhangi biri" ile birleştirilmiş en fazla
8 karşılaştırmadan ibaret. Repodaki üç kural setinin üçü de zaten böyle. Bu
şekle uymayan bir kural seti `fromRuleset()`'ten `null` döner ve editör
**açılmaz**: sessizce düzleştirmek, kullanıcının okuduğu cümle ile kaydettiği
kuralı ayırırdı.

**İd yok.** Şemada indikatörler önce bir `id` ile tanımlanıp koşulda o id ile
anılıyor — tam olarak gizlemeye çalıştığımız programlama kavramı. Formda
karşılaştırmanın tarafı doğrudan "RSI · 14" olarak seçiliyor; `indicators`
listesi ve id'leri `toRuleset()` üretiyor ve aynı indikatör iki kez
kullanılırsa tekilleştiriyor. Üretilen id'ler (`rsi_14`, `bbands_20_2_lower`)
iç detay, kullanıcı hiç görmüyor.

Asıl sözleşme bir testle sabitlenmiş: bir kural setini forma açıp geri
kapatmak **anlamını değiştirmez**. İd'ler değişebilir, `describe()` cümleleri
birebir aynı kalır.

## `describe` saf, `loadLocale` değil

Editörün canlı önizlemesi `toRuleset` + `describe` zincirini tarayıcıda
çalıştırıyor — yani önizlemedeki cümle ile katalogdaki cümle aynı kodun
çıktısı. Bunun için `describe.ts` dosya sistemine dokunmuyor; diskten okuyan
`loadLocale()` ayrı bir modülde (`load-locale.ts`) ve yalnızca CLI kullanıyor.
Bundle'lanmış ortamlar `locales.ts`'teki statik haritayı kullanır.

## Dil ekleme

`src/locales/<kod>.json` ekle. Kod değişmez — değişmesi gerekiyorsa
soyutlamada bir sorun var demektir, lütfen bildir.

Eksik bir anahtar sessizce `{left}` gibi bir şey basmaz, anlaşılır bir hata
fırlatır:

```
locale is missing the "ops.lt" key
```

Dil dosyası kuralları ve gerekçeleri:
[`CONTRIBUTING.md`](../../CONTRIBUTING.md#contributing-a-language)

## JSON Schema

`ruleset.schema.json` **üretilen** bir dosyadır, elle düzenlenmez:

```sh
pnpm --filter @rudder/ruleset emit-schema
```

Yalnızca yapısal kontrolleri içerir — anlamsal kontroller JSON Schema'da ifade
edilemez. Bu yüzden tek başına güvenlik sınırı değildir; doğrulama her zaman
`validateRuleset()` üzerinden yapılmalıdır.

## Geliştirme

```sh
pnpm --filter @rudder/ruleset test
pnpm --filter @rudder/ruleset typecheck
```

Testler dış bağımlılık kullanmaz (`node:test`). Şema testleri repo kökündeki
[`rulesets/`](../../rulesets) dizinini okur: oradaki her kural seti geçerli,
`_invalid/` içindeki her dosya geçersiz olmak zorundadır.
