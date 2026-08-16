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
