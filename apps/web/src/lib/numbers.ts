import "server-only";

/**
 * Yüzde biçimi tek yerde.
 *
 * Ondalık basamak sayısı SABİT: sütunlar tabular-nums ile hizalanıyor ve
 * "-%3" ile "-%11,8" yan yana geldiğinde ilki olduğundan kaba görünüyor.
 */
export const PERCENT = {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
} as const;

/**
 * Gösterilecek hassasiyette sıfır olan bir değeri işaretsiz sıfıra çeker.
 *
 * `-0,0004` bir basamakta `-%0,0` diye yazılıyor ve eksi işaretli bir sıfır,
 * olmayan bir kaybı varmış gibi gösteriyor. Ölçüldü: hiç işlem kapatmamış bir
 * bot ekranda `-%0,0` getiri bildirdi.
 */
export function displayable(value: number): number {
  return Math.abs(value) < 0.0005 ? 0 : value;
}
