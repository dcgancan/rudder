/**
 * Drawdown eğrisi — bu arayüzün imza öğesi.
 *
 * Yükselen bir getiri grafiği yerine stratejinin kendi zirvesinin ne kadar
 * altında kaldığını çiziyoruz. Her zaman sıfırın altında olduğu için pazarlama
 * malzemesine dönüşemez, ve yeni başlayan biri için en karar verdirici sayı bu.
 *
 * Deniz haritasındaki derinlik konturuna benzemesi tesadüf değil: bu düşüşün
 * İngilizcedeki adı zaten "underwater".
 *
 * Çizim bir ÖLÇÜM ALANI olarak kuruluyor: üstte datum çizgisi (zirve, 0),
 * altta ölçüm tabanı. Test edilmemiş bir strateji bu alanı boş bırakır — boş
 * bir alan "ölçülmedi" der; başıboş bir çizgi hiçbir şey demez.
 */

type Props = {
  /** Negatif oranlar (-0.12 = %12 düşüş). null: hiç test edilmemiş. */
  points: number[] | null;
  label: string;
  untestedLabel: string;
};

const WIDTH = 148;
const HEIGHT = 46;
const DATUM = 11;
const FLOOR = HEIGHT - 5;

export function UnderwaterTrace({ points, label, untestedLabel }: Props) {
  const tested = points !== null && points.length > 1;

  return (
    <figure className="m-0 w-[9.25rem] shrink-0">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full overflow-visible"
        role="img"
        aria-label={tested ? label : untestedLabel}
      >
        {/* Datum: stratejinin kendi zirvesi. Soundings bir referansa göre okunur. */}
        <text
          x={0}
          y={5}
          className="sounding"
          fontSize={7}
          fill="var(--color-ink-soft)"
          letterSpacing="0.06em"
        >
          0
        </text>

        <line x1={0} y1={DATUM} x2={WIDTH} y2={DATUM} stroke="var(--color-ink-soft)" strokeWidth={1} />
        {/* Uç çentikler — ölçüm alanının sınırlarını belirler. */}
        <line x1={0} y1={DATUM} x2={0} y2={DATUM + 3} stroke="var(--color-ink-soft)" strokeWidth={1} />
        <line
          x1={WIDTH}
          y1={DATUM}
          x2={WIDTH}
          y2={DATUM + 3}
          stroke="var(--color-ink-soft)"
          strokeWidth={1}
        />

        {tested ? <Contour points={points} /> : null}

        {/* Ölçüm tabanı. */}
        <line
          x1={0}
          y1={FLOOR}
          x2={WIDTH}
          y2={FLOOR}
          stroke="var(--color-rule)"
          strokeWidth={1}
          strokeDasharray="2 3"
        />
      </svg>

      <figcaption className="label mt-1.5 block leading-snug">
        {tested ? label : untestedLabel}
      </figcaption>
    </figure>
  );
}

function Contour({ points }: { points: number[] }) {
  const deepest = Math.min(...points, -0.0001);
  const step = WIDTH / (points.length - 1);

  const toY = (value: number) => DATUM + (Math.abs(value) / Math.abs(deepest)) * (FLOOR - DATUM);

  const line = points.map((value, i) => `${i === 0 ? "M" : "L"}${i * step},${toY(value)}`).join(" ");
  const area = `${line} L${WIDTH},${DATUM} L0,${DATUM} Z`;

  return (
    <>
      <path d={area} fill="var(--color-depth)" fillOpacity={0.16} />
      <path d={line} fill="none" stroke="var(--color-depth)" strokeWidth={1.25} />
    </>
  );
}
