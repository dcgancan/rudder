"use client";

import { useLocale, useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

const NAMES: Record<string, string> = { en: "English", tr: "Türkçe" };

export function SiteHeader() {
  const t = useTranslations("site");
  const active = useLocale();
  const pathname = usePathname();

  return (
    <header className="border-rule border-b">
      <div className="mx-auto flex max-w-4xl items-baseline justify-between gap-6 px-6 py-5">
        <Link href="/" className="text-ink no-underline">
          <span className="font-display text-lg font-semibold tracking-tight">{t("name")}</span>
          <span className="text-ink-soft ml-3 hidden text-sm sm:inline">{t("tagline")}</span>
        </Link>

        <nav aria-label="Language" className="flex items-baseline gap-3">
          {routing.locales.map((locale) => (
            <Link
              key={locale}
              href={pathname}
              locale={locale}
              hrefLang={locale}
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
