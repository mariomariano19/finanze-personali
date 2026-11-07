// Formattazione e parsing degli importi (centesimi interi).

// Formattazione manuale: Intl in italiano non separa le migliaia a 4 cifre (1234) e varia tra browser.
function groupThousands(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function formatAbs(absCents: number, decimals: boolean): string {
  const rounded = Math.round(absCents);
  if (!decimals) return groupThousands(String(Math.round(rounded / 100)));
  const int = Math.floor(rounded / 100);
  const dec = String(rounded % 100).padStart(2, '0');
  return `${groupThousands(String(int))},${dec}`;
}

/** 123456 -> "1.234,56 €" ; con short=true arrotonda all'euro se l'importo è >= 100 € */
export function formatEUR(cents: number, opts: { sign?: boolean; short?: boolean } = {}): string {
  const abs = Math.abs(cents);
  const useShort = opts.short && abs >= 10000;
  const body = formatAbs(abs, !useShort);
  const sign = cents < 0 ? '−' : opts.sign && cents > 0 ? '+' : '';
  return `${sign}${body} €`;
}

/** Interpreta "12,50" / "12.50" / "1.234,56" / "1234" come centesimi. Restituisce null se non valido. */
export function parseEUR(input: string): number | null {
  let s = input.trim().replace(/€/g, '').replace(/\s/g, '');
  if (!s) return null;
  const neg = s.startsWith('-') || s.startsWith('−');
  s = s.replace(/^[-−+]/, '');
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    // il separatore che compare per ultimo è quello decimale
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    s = s.replace(',', '.');
  } else if (lastDot >= 0) {
    // "1.234" con tre cifre dopo il punto = migliaia all'italiana
    const decimals = s.length - lastDot - 1;
    if (decimals === 3 && s.split('.').length >= 2) s = s.replace(/\./g, '');
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const value = Math.round(parseFloat(s) * 100);
  if (!Number.isFinite(value)) return null;
  return neg ? -value : value;
}

/** Percentuale formattata: 0.3123 -> "31%" */
export function formatPct(ratio: number, opts: { sign?: boolean; decimals?: number } = {}): string {
  if (!Number.isFinite(ratio)) return '–';
  const d = opts.decimals ?? 0;
  const v = (ratio * 100).toFixed(d).replace('.', ',');
  const sign = opts.sign && ratio > 0 ? '+' : ratio < 0 ? '−' : '';
  return `${sign}${v.replace('-', '')}%`;
}

/** Variazione relativa tra due valori; null se il riferimento è zero */
export function change(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}
