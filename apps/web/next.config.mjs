import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import("next").NextConfig} */
const nextConfig = {
  // Workspace paketleri TypeScript kaynağı olarak yayınlanıyor (build adımı
  // yok), bu yüzden Next'in onları derlemesi gerekiyor.
  transpilePackages: ["@rudder/ruleset", "@rudder/db", "@rudder/orchestrator"],

  // better-sqlite3 native bir modül; bundle edilemez.
  serverExternalPackages: ["better-sqlite3"],

  // Tek container dağıtımı için: `next build` kendi kendine yeten bir çıktı üretir.
  output: "standalone",
};

export default withNextIntl(nextConfig);
