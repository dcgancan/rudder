"use client";

import { useEffect } from "react";

import { useRouter } from "@/i18n/navigation";

/**
 * Sayfayı belirli aralıklarla sunucudan yeniden çizer.
 *
 * Backtest tarafındaki gibi ayrı bir JSON ucu YOK ve bu bilinçli: orada
 * değişen tek şey bir durum alanıydı ve dakikalarca sürüyordu, yani hafif bir
 * durum sorgusu doğru cevaptı. Burada pozisyonlar, cüzdan ve kâr sürekli
 * değişiyor — yani sayfanın kendisi zaten "yeni veri" demek. İkinci bir veri
 * şekli çıkarmak, aynı sayıları iki ayrı yerde biçimlendirmek olurdu.
 */
export function AutoRefresh({ everyMs, active }: { everyMs: number; active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;

    const timer = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(timer);
  }, [active, everyMs, router]);

  return null;
}
