/** จัดรูปแบบตัวเลข/เวลา ตามภาษาที่เลือก (I18nProvider ตั้งให้ตอน render) */

const LOCALES = { th: 'th-TH', en: 'en-US' } as const;
let locale: string = LOCALES.en;

export function setLocale(lang: keyof typeof LOCALES): void {
  locale = LOCALES[lang];
}

export function formatUsd(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v) || v === 0) return '—';
  return formatUsdExact(v);
}

/** เหมือน formatUsd แต่ศูนย์แสดงเป็น $0.00 (ใช้กับส่วนต่าง/ยอดรวมค่าใช้จ่าย) */
export function formatUsdExact(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  const digits = abs > 0 && abs < 1 ? 4 : 2;
  return v.toLocaleString(locale, {
    style: 'currency',
    currency: 'USD',
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: digits,
  });
}

/** ยอดแบบสั้นสำหรับกราฟ/ป้ายบอกค่า: $12.4K · $1.2M (ศูนย์เป็น $0) */
export function formatUsdCompact(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1000) return `${v < 0 ? '-' : ''}$${abs.toLocaleString(locale, { notation: 'compact', maximumFractionDigits: 1 })}`;
  return `${v < 0 ? '-' : ''}$${abs.toLocaleString(locale, { maximumFractionDigits: abs > 0 && abs < 1 ? 4 : 2 })}`;
}

/** วันที่แบบสั้นของแกนกราฟ: 21 ก.ย. · Sep 21 */
export function formatDayShort(ms: number): string {
  return new Date(ms).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

export function formatAmount(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs === 0) return '0';
  if (abs >= 1e9) return v.toLocaleString(locale, { notation: 'compact', maximumFractionDigits: 2 });
  if (abs >= 1) return v.toLocaleString(locale, { maximumFractionDigits: 4 });
  return v.toLocaleString(locale, { maximumSignificantDigits: 4 });
}

/** แบบย่อในแผงรายละเอียด: ทศนิยมไม่เกิน 4 ตำแหน่ง ตัดศูนย์ท้าย (18,506 · 18,506.2753 · 4.3745 · 4) — ค่าเต็มคัดลอกได้จาก data-value */
export function formatAmountShort(v: number): string {
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

/** ตัวเลขเต็มความละเอียดที่ข้อมูลมี (ไม่ปัด) มีตัวคั่นหลัก — ใช้ในแผงรายละเอียด */
export function formatAmountFull(v: number): string {
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString(locale, { maximumFractionDigits: 20 });
}

/** ทศนิยมแบบสตริง (ครบทุกหลัก) → ใส่ตัวคั่นหลักตามภาษา ไม่แตะส่วนทศนิยม */
export function formatDecimalText(s: string): string {
  const neg = s.startsWith('-');
  const [i = '0', f] = (neg ? s.slice(1) : s).split('.');
  const sep = (1.1).toLocaleString(locale).charAt(1);
  return `${neg ? '−' : ''}${BigInt(i).toLocaleString(locale)}${f ? `${sep}${f}` : ''}`;
}

/** ราคาต่อหน่วย — เหรียญราคาจิ๋ว (1e-7) ต้องเห็นเลขนัยสำคัญ ไม่ใช่ $0.00 */
export function formatPrice(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v) || v === 0) return '—';
  const abs = Math.abs(v);
  const opts = abs >= 1 ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumSignificantDigits: 4 };
  return `${v < 0 ? '-' : ''}$${abs.toLocaleString(locale, opts)}`;
}

/** เวลาแบบสัมพัทธ์: 29 min ago · 1 hr ago · 15:04, yesterday · 17:48, 17 Sep 26 */
export function formatRelative(unixSeconds: number, t: (k: 'time.justNow' | 'time.minAgo' | 'time.hrAgo' | 'time.yesterday', v?: Record<string, string | number>) => string): string {
  const d = new Date(unixSeconds * 1000);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return t('time.justNow');
  if (diff < 3600) return t('time.minAgo', { n: Math.floor(diff / 60) });
  if (diff < 24 * 3600) return t('time.hrAgo', { n: Math.floor(diff / 3600) });
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return t('time.yesterday', { time });
  return `${time}, ${d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: '2-digit' })}`;
}

/** ค่าธรรมเนียม: ต่ำกว่าหน่วยที่แสดงได้ → "< $0.01" / "< 0.0001 ETH" */
export function formatFeeUsd(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (v > 0 && v < 0.01) return '< $0.01';
  return formatUsd(v);
}
export function formatFeeNative(v: number | null | undefined, symbol: string): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (v > 0 && v < 0.0001) return `< 0.0001 ${symbol}`;
  return `${v.toLocaleString(locale, { maximumSignificantDigits: 4 })} ${symbol}`;
}

/** "Sep 21 2026 06:42" */
export function formatStamp(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return `${d.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' })} ${d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false })}`;
}

export function formatDate(unixSeconds: number): { date: string; time: string } {
  const d = new Date(unixSeconds * 1000);
  return {
    date: d.toLocaleDateString(locale, { year: '2-digit', month: 'short', day: 'numeric' }),
    time: d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
  };
}

export function shortAddr(a: string): string {
  return a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export function shortHash(h: string): string {
  return h.length > 14 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h;
}
