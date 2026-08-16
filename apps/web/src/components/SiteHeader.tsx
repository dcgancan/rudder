"use client";

import { useLocale, useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

const NAMES: Record<string, string> = { en: "English", tr: "Türkçe" };

export function SiteHeader() {
  const t = useTranslations();
  const active = useLocale();
  const pathname = usePathname();

  return (
    <header className="border-rule border-b">
      <div className="mx-auto flex max-w-4xl flex-wrap items-baseline justify-between gap-x-6 gap-y-2 px-6 py-5">
        <div className="flex items-baseline gap-6">
          <Link href="/" className="text-ink no-underline">
            <span className="font-display text-lg font-semibold tracking-tight">
              {t("site.name")}
            </span>
          </Link>

          <nav aria-label={t("nav.strategies")} className="flex items-baseline gap-4">
            <Section href="/" label={t("nav.strategies")} current={isCatalog(pathname)} />
            <Section href="/bots" label={t("nav.bots")} current={pathname.startsWith("/bots")} />
          </nav>
        </div>

        <nav aria-label="Language" className="flex items-baseline gap-3">
          {routing.locales.map((locale) => (
            <Link
              key={locale}
              href={pathname}
              locale={locale}
              hrefLang={locale}
              // Dilin kendi adı kendi diliyle etiketlenmeli: `.label` büyük
              // harfe çevirirken dili kullanıyor ve Türkçe sayfada "English"
              // aksi halde "ENGLİSH" oluyor.
              lang={locale}
              aria-current={locale === active ? "true" : undefined}
              className={
                locale === active
                  ? "label text-ink no-underline"
                  : "label text-ink-soft hover:text-depth no-underline"
              }
            >
              {NAMES[locale] ?? locale}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}

/** Strateji detayları da katalogun altında; onlar da "Stratejiler"i işaretler. */
function isCatalog(pathname: string): boolean {
  return pathname === "/" || pathname.startsWith("/strategies");
}

function Section({ href, label, current }: { href: string; label: string; current: boolean }) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={
        current ? "label text-ink no-underline" : "label text-ink-soft hover:text-depth no-underline"
      }
    >
      {label}
    </Link>
  );
}
