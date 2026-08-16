import { getBacktest } from "@/lib/backtests";

/**
 * Çalışan bir testin durumu.
 *
 * Arayüz bunu birkaç saniyede bir soruyor; sonuç bitince sayfanın kendisi
 * yeniden çiziliyor. Bu uç yalnızca durumu döndürür — ölçümün tamamı sunucu
 * bileşeninden gelir, iki yerde iki farklı biçimde üretilmesin diye.
 */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const row = getBacktest(id);

  if (!row) return Response.json({ error: "not found" }, { status: 404 });

  return Response.json(
    { status: row.status },
    { headers: { "cache-control": "no-store" } },
  );
}
