import { getTranslations } from "next-intl/server";

export async function SiteFooter() {
  const t = await getTranslations("footer");

  return (
    <footer className="border-rule mt-16 border-t">
      <div className="text-ink-soft mx-auto flex max-w-4xl flex-wrap items-baseline gap-x-4 gap-y-2 px-6 py-8 text-sm">
        <span>{t("license")}</span>
        <a
          href="https://github.com/dcgancan/rudder"
          className="text-depth underline underline-offset-4"
        >
          {t("source")}
        </a>
      </div>
    </footer>
  );
}
