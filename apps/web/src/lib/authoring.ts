import "server-only";

import { randomUUID } from "node:crypto";

import { and, desc, eq, isNull } from "drizzle-orm";

import { rulesets } from "@rudder/db";
import type { RulesetRow } from "@rudder/db";
import { slugFor, toRuleset, validateRuleset } from "@rudder/ruleset";
import type { Draft } from "@rudder/ruleset";

import { db } from "./db";

/**
 * Kullanıcının yazdığı stratejilerin kaydedilmesi.
 *
 * Doğrulama BURADA yetkili. Editör aynı `validateRuleset()`'i tarayıcıda da
 * çağırıyor ama o bir kolaylık: kullanıcıya anında geri bildirim vermek için.
 * Kaydeden taraf ona güvenmez.
 */

export type SaveResult =
  | { ok: true; slug: string; version: number }
  | { ok: false; errors: { path: string; message: string }[] };

/**
 * Düzenlemek yeni bir SÜRÜM, çatallamak yeni bir STRATEJİ yaratır.
 *
 * | Kaynak | Sonuç |
 * |---|---|
 * | yok (sıfırdan) | yeni slug, v1 |
 * | `builtin` | yeni slug, v1, `forkedFromId` kaynağa bakar |
 * | `local` / `imported` | aynı slug, v+1 |
 *
 * Builtin'i yerinde sürümlemek olmaz: `seed.ts` builtin slug'ların sahibi ve
 * repodaki dosya değiştiğinde yeni sürüm ekliyor — kullanıcının sürümüyle
 * çakışırdı.
 *
 * Kural setleri değişmez olduğu için hiçbir yolda eski sürüm kaybolmuyor;
 * v1'i çalıştıran bir bot v1'i çalıştırmaya devam eder.
 */
export function saveDraft(draft: Draft, locale: string, from?: RulesetRow): SaveResult {
  const forking = !from || from.source === "builtin";

  const slug = forking ? uniqueSlug(slugFor(draft.name)) : from.slug;
  if (!slug) {
    return { ok: false, errors: [{ path: "name", message: "the name has no letters or digits" }] };
  }

  const version = forking ? 1 : latestVersion(slug) + 1;
  const result = validateRuleset(toRuleset(draft, slug, locale));
  if (!result.ok) return { ok: false, errors: result.errors };

  db.insert(rulesets)
    .values({
      id: randomUUID(),
      slug,
      version,
      body: result.ruleset,
      source: "local",
      ...(forking && from ? { forkedFromId: from.id } : {}),
    })
    .run();

  return { ok: true, slug, version };
}

/**
 * Katalogdan gizler. Satır SİLİNMEZ.
 *
 * Ona bağlı botlar ve ölçümler duruyor; bir stratejiyi silmek, açılmış bir
 * işlemin hangi kurallarla açıldığı sorusunu cevapsız bırakırdı.
 */
export function archiveStrategy(slug: string): void {
  const now = new Date();

  for (const row of db.select().from(rulesets).where(eq(rulesets.slug, slug)).all()) {
    if (row.archivedAt) continue;
    db.update(rulesets).set({ archivedAt: now }).where(eq(rulesets.id, row.id)).run();
  }
}

/** Düzenlenecek sürüm: bir slug'ın arşivlenmemiş en yüksek sürümü. */
export function editableRuleset(slug: string): RulesetRow | null {
  return (
    db
      .select()
      .from(rulesets)
      .where(and(eq(rulesets.slug, slug), isNull(rulesets.archivedAt)))
      .orderBy(desc(rulesets.version))
      .get() ?? null
  );
}

function latestVersion(slug: string): number {
  const rows = db.select({ version: rulesets.version }).from(rulesets).where(eq(rulesets.slug, slug)).all();
  return rows.reduce((highest, row) => Math.max(highest, row.version), 0);
}

/**
 * Çakışan slug'a sayı ekler.
 *
 * Arşivlenmiş satırlar da sayılır: slug bir sürüm ailesinin adı ve
 * arşivlenmiş bir aileyi yeni bir stratejiyle karıştırmak, o aileye bağlı
 * ölçümleri yanlış stratejiye bağlamak olurdu.
 */
function uniqueSlug(base: string): string {
  if (!base) return "";

  const taken = new Set(db.select({ slug: rulesets.slug }).from(rulesets).all().map((row) => row.slug));
  if (!taken.has(base)) return base;

  for (let suffix = 2; suffix < 1000; suffix++) {
    const candidate = `${base.slice(0, 60)}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }

  return `${base.slice(0, 55)}-${randomUUID().slice(0, 6)}`;
}
