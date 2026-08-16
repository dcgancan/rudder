"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";

import type { Draft } from "@rudder/ruleset";

import { redirect } from "@/i18n/navigation";
import { archiveStrategy as archive, editableRuleset, saveDraft } from "@/lib/authoring";

/**
 * Strateji yazma eylemleri.
 *
 * Taslak forma gizli bir JSON alanı olarak giriyor. Diğer formların aksine
 * burada aşamalı geliştirme yok: satır ekleyip çıkaran, canlı önizleme çizen
 * bir editör JavaScript olmadan zaten çalışmaz. Bunun yerine editör kaydetme
 * düğmesini hidrasyon tamamlanana kadar kapalı tutuyor — yoksa erken bir
 * tıklama, kullanıcının yazdığını değil BAŞLANGIÇ taslağını kaydederdi.
 */

export type SaveState = { errors: { path: string; message: string }[] } | null;

export async function saveStrategy(_previous: SaveState, form: FormData): Promise<SaveState> {
  const draft = JSON.parse(String(form.get("draft") ?? "{}")) as Draft;
  const editing = String(form.get("slug") ?? "");

  const from = editing ? (editableRuleset(editing) ?? undefined) : undefined;
  const result = saveDraft(draft, await getLocale(), from);

  if (!result.ok) return { errors: result.errors };

  revalidatePath("/", "layout");
  // `redirect()` fırlatarak çalışır; buradan sonrası çalışmaz.
  redirect({ href: `/strategies/${result.slug}`, locale: await getLocale() });
  return null;
}

export async function archiveStrategy(form: FormData): Promise<void> {
  const slug = String(form.get("slug") ?? "");
  if (!slug) throw new Error("no strategy slug in the form");

  archive(slug);

  revalidatePath("/", "layout");
  redirect({ href: "/", locale: await getLocale() });
}
