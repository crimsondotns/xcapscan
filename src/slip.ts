/**
 * สลิปธุรกรรม — ข้อมูลที่แสดงบนสลิป, รหัสยืนยัน (SHA-256 ของข้อมูล), เก็บสำเนาในเครื่อง, และวาดเป็นภาพ
 *
 * ทุกอย่างอยู่ในเบราว์เซอร์: ไม่มีเซิร์ฟเวอร์เซ็น ไม่มี URL ตรวจกลาง — รหัสยืนยันคือแฮชของเนื้อหา
 * ใครมีลิงก์แชร์ (ซึ่งพกข้อมูลไปเอง) เปิดในแอปนี้แล้วตรวจได้ว่าเนื้อหายังตรงกับรหัสหรือถูกแก้
 * สำเนาที่เก็บในเครื่องไม่ถูกเขียนทับ (รหัสเดิม = ระเบียนเดิม)
 */
import QRCode from 'qrcode';
import type { TxRow } from './feed';
import { formatAmountFull, formatAmountShort, formatFeeNative, formatFeeUsd, formatStamp, formatUsdExact, shortAddr } from './format';
import { tokenColor } from './chainStyle';
import { absoluteUrl } from './router';
import { SLIP_SHOW_DEFAULT, type SlipShow } from './store';
import { identiconHue } from './components/Identicon';

export interface SlipMove {
  dir: 'in' | 'out';
  amount: number;
  symbol: string;
  /** อนุมัติวงเงิน — ไม่ใช่การส่ง */
  approve?: true;
  /** เหรียญพื้นเมืองของเชน (ไม่มี tokenId) */
  native?: true;
  /** แสดงผลอย่างเดียว ไม่อยู่ในแฮช */
  usd?: number | null;
  logo?: string | null;
}

/** เนื้อหาสลิป — ค่าที่ถูกแฮชเป็นรหัสยืนยัน (ลำดับ key คงที่) */
export interface SlipData {
  v: 1;
  hash: string;
  chain: string;
  chainName: string;
  type: string;
  status: 'ok' | 'failed';
  wallet: string;
  walletLabel: string;
  from: string | null;
  to: string | null;
  /** ป้ายชื่อกระเป๋าของ from/to ถ้าเป็นกระเป๋าที่ผู้ใช้ตั้งชื่อไว้ — แสดงผลอย่างเดียว */
  fromLabel?: string | null;
  toLabel?: string | null;
  moves: SlipMove[];
  fee: number | null;
  feeSymbol: string;
  time: number;
  /** ลิงก์ explorer ของธุรกรรม (ถ้ามี) — ใส่ใน QR */
  url: string | null;
  /** โลโก้โทเคนหลัก / โลโก้เชน (https) — แสดงผลอย่างเดียว ไม่อยู่ในแฮช */
  tokenLogo?: string | null;
  chainLogo?: string | null;
  /** ส่วนต่างสวอป (USD) / ค่าเครือข่าย (USD) — แสดงผลอย่างเดียว */
  feeUsd?: number | null;
  /** น่าสงสัย/หลอกลวง (อยู่ในแฮช) + เหตุผลที่แสดง (ข้อความตามภาษา ไม่อยู่ในแฮช) */
  flagged?: boolean;
  reasons?: string[];
  /** ชื่อโปรโตคอล/คู่สัญญา + ชนิด (Bridge/Aggregator/…) — แสดงผลอย่างเดียว */
  protocol?: string | null;
  protocolKind?: string | null;
  /** เวลาออกสลิป (ms) */
  issued: number;
}

export interface SlipRecord {
  code: string;
  data: SlipData;
}

const KEY = 'xcap.scan.slips';
const MAX_BYTES = 4 * 1024 * 1024;

export interface SlipExtra {
  chainLogo?: string | null;
  usdOfMove?: (m: TxRow['moves'][number]) => number | null;
  feeUsd?: number | null;
  protocol?: string | null;
  protocolKind?: string | null;
  reasons?: string[];
  /** ชื่อกระเป๋าที่ผู้ใช้ตั้งของที่อยู่ (ถ้ามี) */
  labelOf?: (addr: string) => string | undefined;
}

export function slipData(row: TxRow, wallet: { address: string; label: string } | undefined, chainName: string, native: string, url: string | null, extra: SlipExtra = {}): SlipData {
  const usdOfMove = extra.usdOfMove ?? (() => null);
  const chainLogo = extra.chainLogo ?? null;
  return {
    v: 1,
    hash: row.hash,
    chain: row.chain,
    chainName,
    type: row.type,
    status: row.failed ? 'failed' : 'ok',
    wallet: wallet?.address ?? row.walletId,
    walletLabel: wallet?.label ?? '',
    from: row.from,
    to: row.to,
    fromLabel: row.from ? (extra.labelOf?.(row.from) ?? null) : null,
    toLabel: row.to ? (extra.labelOf?.(row.to) ?? null) : null,
    moves: row.moves
      .filter((m) => m.amount !== 0)
      .map((m) => ({
        dir: m.dir,
        amount: m.amount,
        symbol: m.symbol,
        usd: m.approve ? null : usdOfMove(m),
        logo: m.logo,
        ...(m.approve ? { approve: true as const } : {}),
        ...(m.tokenId === null ? { native: true as const } : {}),
      })),
    fee: row.gasNative,
    feeSymbol: native,
    time: row.time,
    url,
    tokenLogo: (row.moves.find((m) => m.amount !== 0 && m.logo) ?? row.moves.find((m) => m.logo))?.logo ?? null,
    chainLogo,
    feeUsd: extra.feeUsd ?? null,
    protocol: extra.protocol ?? null,
    protocolKind: extra.protocolKind ?? null,
    flagged: row.flagged,
    reasons: row.flagged ? (extra.reasons ?? []) : [],
    issued: Date.now(),
  };
}

/** สตริงที่แฮช: JSON ของฟิลด์ตามลำดับที่กำหนด (ไม่ขึ้นกับลำดับ key ของอ็อบเจ็กต์) */
function canonical(d: SlipData): string {
  return JSON.stringify([
    d.v,
    d.hash,
    d.chain,
    d.type,
    d.status,
    d.wallet,
    d.from,
    d.to,
    d.moves.map((m) => [m.dir, m.amount, m.symbol, m.approve ? 1 : 0]),
    d.flagged ? 1 : 0,
    d.fee,
    d.feeSymbol,
    d.time,
    d.issued,
  ]);
}

export async function slipCode(d: SlipData): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(d)));
  const hex = [...new Uint8Array(buf)]
    .slice(0, 10)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
  return hex.match(/.{1,5}/g)!.join('-');
}

export function normalizeCode(s: string): string {
  const hex = s.toUpperCase().replace(/[^0-9A-F]/g, '');
  return hex.length === 20 ? hex.match(/.{1,5}/g)!.join('-') : '';
}

/* ----------------------------- เก็บในเครื่อง ----------------------------- */

function loadAll(): SlipRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? (list as SlipRecord[]).filter((r) => r && typeof r.code === 'string' && r.data && r.data.v === 1) : [];
  } catch {
    return [];
  }
}

/** เก็บสำเนา — รหัสที่มีอยู่แล้วไม่ถูกแทนที่; เกินโควตาตัดของเก่าสุดทิ้ง */
export function saveSlip(rec: SlipRecord): void {
  const all = loadAll();
  if (all.some((r) => r.code === rec.code)) return;
  all.push(rec);
  let json = JSON.stringify(all);
  while (json.length > MAX_BYTES && all.length > 1) {
    all.shift();
    json = JSON.stringify(all);
  }
  try {
    localStorage.setItem(KEY, json);
  } catch {
    /* เต็มหรือถูกบล็อก */
  }
}

export function findSlip(code: string): SlipRecord | null {
  return loadAll().find((r) => r.code === code) ?? null;
}

export function listSlips(): SlipRecord[] {
  return loadAll().slice().reverse();
}

/* ----------------------------- ลิงก์แชร์ ----------------------------- */

const b64 = (s: string) =>
  btoa(unescape(encodeURIComponent(s)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const unb64 = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

/** ลิงก์พกข้อมูลไปเอง: /verify/<code>.<base64url(json)> — เปิดในแอปนี้ที่ไหนก็ตรวจได้ */
export function shareLink(rec: SlipRecord): string {
  return absoluteUrl(`verify/${rec.code}.${b64(JSON.stringify(rec.data))}`);
}

export function parseShare(fragment: string): { code: string; data: SlipData | null } | null {
  const m = /^([0-9A-F-]+)(?:\.([A-Za-z0-9_-]+))?$/.exec(fragment.trim());
  if (!m) return null;
  const code = normalizeCode(m[1]!);
  if (!code) return null;
  let data: SlipData | null = null;
  if (m[2]) {
    try {
      const d = JSON.parse(unb64(m[2])) as SlipData;
      if (d && d.v === 1 && typeof d.hash === 'string') data = d;
    } catch {
      /* ข้อมูลในลิงก์เสีย */
    }
  }
  return { code, data };
}

export type Verdict = 'valid' | 'tampered' | 'unknown';

/** ตรวจ: มีข้อมูล (จากลิงก์หรือสำเนาในเครื่อง) → แฮชใหม่เทียบรหัส */
export async function verifySlip(code: string, data: SlipData | null): Promise<{ verdict: Verdict; data: SlipData | null; stored: boolean }> {
  const stored = findSlip(code);
  const d = data ?? stored?.data ?? null;
  if (!d) return { verdict: 'unknown', data: null, stored: false };
  const ok = (await slipCode(d)) === code;
  return { verdict: ok ? 'valid' : 'tampered', data: d, stored: !!stored };
}

/* ----------------------------- วาดภาพ ----------------------------- */
/*
 * แบบ "Thermal receipt" (mock 2a ที่ผู้ใช้เลือก 2026-09-22): กว้าง 320 ขอบล่างหยัก เส้นประคั่น
 * หัว XCap Scan กลาง → เช็คเขียว + Transaction successful → วันที่ · เชน → Received/Sent ตัวเลขใหญ่ (เขียวเฉพาะขาเข้า)
 * → บล็อกสินทรัพย์ (โลโก้โทเคน + ตราเชน, จำนวนสีหมึก ไม่ซ้ำสีเขียว) + ค่าเครือข่าย/ส่วนต่างสวอป → Wallet/To/Status
 * → hash เต็ม → QR → รหัสยืนยัน — สีที่ใช้: เขียว/แดงสถานะ + โลโก้เท่านั้น
 */

const FONT = "'Suisse Intl', -apple-system, BlinkMacSystemFont, sans-serif";
const W = 320;
/** ตัวอักษรเล็กสุดที่ยอมย่อลงไปเพื่อไม่ให้ล้นสลิป */
const MIN_SIZE = 9;

/** ขนาดตัวอักษรที่ทำให้ s กว้างไม่เกิน maxW (ย่อทีละ 1px, ไม่ต่ำกว่า MIN_SIZE) */
export function fitSize(ctx: CanvasRenderingContext2D, s: string, size: number, weight: number, maxW: number): number {
  let n = size;
  ctx.font = `${weight} ${n}px ${FONT}`;
  while (n > MIN_SIZE && ctx.measureText(s).width > maxW) {
    n -= 1;
    ctx.font = `${weight} ${n}px ${FONT}`;
  }
  return n;
}

const PAD = 22;
const INK = '#000000';
const MUTED = 'rgba(0,0,0,0.6)';
const DASH = 'rgba(0,0,0,0.3)';
const SCALLOP_R = 6;
const SCALLOP_STEP = 16;

export type SlipAction = 'download' | 'copy' | 'print' | 'share' | 'verify';
/* สีประจำฟังก์ชัน — ค่าจริงอ่านจาก tokens.css ตอนวาด ตรงนี้แค่ค่าสำรอง */
const FN_FALLBACK: Record<SlipAction, string> = { download: '#0066ff', copy: '#059669', print: '#9333ea', share: '#f59e0b', verify: '#10b981' };
const FN_GLYPH: Record<SlipAction, string> = { download: '⤓', copy: '❐', print: '⎙', share: '⤴', verify: '✓' };

interface Labels {
  title: string;
  /** คำว่า "on" ใน "on HyperEVM" */
  on: string;
  action: Record<SlipAction, string>;
  success: string;
  failed: string;
  received: string;
  sent: string;
  approved: string;
  flaggedTitle: string;
  why: string;
  verifyFirst: string;
  protocol: string;
  wallet: string;
  from: string;
  to: string;
  hash: string;
  fee: string;
  time: string;
  chain: string;
  code: string;
  issued: string;
  type: string;
  status: string;
  statusOk: string;
  statusFailed: string;
}

/** โหลดรูปแบบ CORS-safe (ไม่งั้น canvas จะ taint แล้ว export ไม่ได้) — โหลดไม่ได้/ช้าเกิน 4 วิ → null แล้วใช้ตัวอักษรแทน */
function loadImage(url: string | null | undefined): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  return new Promise((res) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const done = (v: HTMLImageElement | null) => {
      clearTimeout(timer);
      res(v);
    };
    const timer = setTimeout(() => done(null), 4000);
    img.onload = () => done(img);
    img.onerror = () => done(null);
    img.src = url;
  });
}

/** รูปวงกลม — ไม่มีรูปก็วาดวงกลมสีพร้อมตัวอักษรแรก (เหมือน <Logo>) */
function circleImage(ctx: CanvasRenderingContext2D, img: HTMLImageElement | null, x: number, y: number, size: number, name: string, color: string) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (img) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, size, size);
    ctx.drawImage(img, x, y, size, size);
  } else {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 ${Math.round(size * 0.42)}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((name[0] ?? '?').toUpperCase(), x + size / 2, y + size / 2 + 1);
  }
  ctx.restore();
}

/** ข้อความหนึ่งชิ้นบนสลิป (พิกัดตรรกะ กว้าง W) — ใช้วางชั้นข้อความที่เลือกได้ทับภาพ */
export interface SlipText {
  s: string;
  x: number;
  /** baseline */
  y: number;
  size: number;
  weight: number;
  align: CanvasTextAlign;
  w: number;
}
export interface SlipImage {
  canvas: HTMLCanvasElement;
  texts: SlipText[];
  /** ขนาดตรรกะ (ก่อนคูณ 2) */
  width: number;
  height: number;
}

/** วาดสลิปลง canvas ใหม่ (ความละเอียด 2 เท่า) — พื้นขาวเสมอ ไม่ตามธีมหน้าจอ เพราะเป็นเอกสาร; นอกขอบหยักโปร่งใส */
export async function renderSlip(rec: SlipRecord, L: Labels, action: SlipAction | null = null, show: SlipShow = SLIP_SHOW_DEFAULT): Promise<SlipImage> {
  const texts: SlipText[] = [];
  try {
    await Promise.all([document.fonts.load(`400 16px ${FONT}`), document.fonts.load(`600 16px ${FONT}`)]);
  } catch {
    /* ฟอนต์ไม่มา → ใช้สำรอง */
  }
  const d = rec.data;
  const [chainImg, ...moveImgs] = await Promise.all([loadImage(d.chainLogo), ...d.moves.map((m) => loadImage(m.logo))]);
  const POSITIVE = tokenColor('positive', '#16a34a');
  const DANGER = tokenColor('danger', '#dc2626');
  const WARN = tokenColor('warn', '#d97706');
  const WARN_SOFT = tokenColor('warn-soft', '#fef3c7');
  const WARN_INK = tokenColor('warn-ink', '#78350f');
  const risky = d.flagged === true;
  const ins = d.moves.filter((m) => m.dir === 'in');
  const outs = d.moves.filter((m) => m.dir === 'out');
  const ordered = [...outs, ...ins];
  // ตัวเลขใหญ่: ขาเข้า (สวอป/รับ) เป็น "Received +x" เขียว; มีแต่ขาออก → "Sent −x" สีหมึก
  const lead = ins[0] ?? outs[0] ?? null;
  const qr = document.createElement('canvas');
  await QRCode.toCanvas(qr, d.url ?? d.hash, { margin: 0, width: 96, color: { dark: INK, light: '#ffffff' } });

  /** ความกว้างที่ข้อความมีได้ ณ จุดนั้น ตามการจัดแนว */
  const room = (x: number, align: CanvasTextAlign): number => (align === 'center' ? W - PAD * 2 : align === 'right' || align === 'end' ? x - PAD : W - PAD - x);
  const draw = (ctx: CanvasRenderingContext2D, dry: boolean): number => {
    let y = PAD;
    const text = (s: string, x: number, yy: number, size: number, weight = 400, color = INK, align: CanvasTextAlign = 'left') => {
      // กันล้นขอบสลิป: กว้างเกินที่ว่างตามการจัดแนว → ลดขนาดตัวอักษรทีละ 1px จนพอดี (ไม่ต่ำกว่า MIN_SIZE)
      size = fitSize(ctx, s, size, weight, room(x, align));
      ctx.font = `${weight} ${size}px ${FONT}`;
      ctx.fillStyle = color;
      ctx.textAlign = align;
      ctx.textBaseline = 'alphabetic';
      if (dry) return;
      ctx.fillText(s, x, yy);
      // จดตำแหน่งไว้ให้ชั้นข้อความโปร่งใสทับภาพ → เลือก/ไฮไลต์/คัดลอกได้เหมือนข้อความจริง
      texts.push({ s, x, y: yy, size, weight, align, w: ctx.measureText(s).width });
    };
    const wrap = (s: string, x: number, yy: number, size: number, maxW: number, weight = 400, color = INK, align: CanvasTextAlign = 'left'): number => {
      ctx.font = `${weight} ${size}px ${FONT}`;
      const lines: string[] = [];
      let cur = '';
      for (const ch of s.includes(' ') ? s.split(' ').map((w, i) => (i ? ` ${w}` : w)) : [...s]) {
        if (ctx.measureText(cur + ch).width > maxW && cur) {
          lines.push(cur);
          cur = ch.trimStart();
        } else cur += ch;
      }
      if (cur) lines.push(cur);
      lines.forEach((ln, i) => text(ln, x, yy + i * size * 1.45, size, weight, color, align));
      return lines.length * size * 1.45;
    };
    const dash = (yy: number) => {
      if (dry) return;
      ctx.save();
      ctx.strokeStyle = DASH;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(PAD, yy + 0.5);
      ctx.lineTo(W - PAD, yy + 0.5);
      ctx.stroke();
      ctx.restore();
    };
    const mark = (x: number, yy: number, s: number) => {
      if (dry) return;
      const k = s / 32;
      ctx.strokeStyle = INK;
      ctx.fillStyle = INK;
      ctx.lineWidth = Math.max(1, k);
      ctx.beginPath();
      ctx.arc(x + 16 * k, yy + 16 * k, 14.5 * k, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillRect(x + 13.2 * k, yy + 13.2 * k, 5.6 * k, 5.6 * k);
      for (const [cx, cy] of [
        [8, 8],
        [21, 8],
        [8, 21],
        [21, 21],
      ] as const)
        ctx.strokeRect(x + cx * k, yy + cy * k, 3 * k, 3 * k);
    };
    const kv = (label: string, value: string, size = 12, weight = 400, color = INK) => {
      text(label, PAD, y + 12, size, 400, MUTED);
      text(value, W - PAD, y + 12, size, weight, color, 'right');
      y += 20;
    };

    // หัว: XCap Scan กลาง
    ctx.font = `600 15px ${FONT}`;
    const brand = 'XCap Scan';
    const bw = ctx.measureText(brand).width + 28;
    mark(W / 2 - bw / 2, y - 2, 20);
    text(brand, W / 2 - bw / 2 + 28, y + 13, 15, 600);
    y += 34;
    // เช็คเขียว / กากบาทแดง + สถานะ
    const ok = d.status === 'ok';
    if (!dry) {
      ctx.fillStyle = risky ? WARN : ok ? POSITIVE : DANGER;
      ctx.beginPath();
      ctx.arc(W / 2, y + 24, 24, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      if (risky) {
        // สามเหลี่ยมเตือน + เครื่องหมายตกใจ
        ctx.moveTo(W / 2, y + 13);
        ctx.lineTo(W / 2 + 11, y + 33);
        ctx.lineTo(W / 2 - 11, y + 33);
        ctx.closePath();
        ctx.moveTo(W / 2, y + 21);
        ctx.lineTo(W / 2, y + 26);
        ctx.moveTo(W / 2, y + 29.5);
        ctx.lineTo(W / 2, y + 29.6);
      } else if (ok) {
        ctx.moveTo(W / 2 - 9, y + 25);
        ctx.lineTo(W / 2 - 3, y + 31);
        ctx.lineTo(W / 2 + 10, y + 17);
      } else {
        ctx.moveTo(W / 2 - 8, y + 16);
        ctx.lineTo(W / 2 + 8, y + 32);
        ctx.moveTo(W / 2 + 8, y + 16);
        ctx.lineTo(W / 2 - 8, y + 32);
      }
      ctx.stroke();
    }
    y += 62;
    text(risky ? L.flaggedTitle : ok ? L.success : L.failed, W / 2, y + 6, 16, 600, INK, 'center');
    y += 24;
    text(`${formatStamp(d.time)} · ${d.chainName}`, W / 2, y + 4, 12, 400, MUTED, 'center');
    y += 18;
    dash(y);
    y += 20;

    // กล่องเหตุผล (เหลืองอ่อน) — "Why this is flagged" + รายการ
    if (risky && d.reasons && d.reasons.length) {
      const bx = PAD;
      const bw2 = W - PAD * 2;
      const inner = bw2 - 24;
      // วัดสูงก่อน
      const probe2 = ctx;
      probe2.font = `400 11px ${FONT}`;
      let bh = 12 + 16;
      const lines: string[][] = d.reasons.map((r) => {
        const out: string[] = [];
        let cur = '';
        for (const w of r.split(' ')) {
          const next = cur ? `${cur} ${w}` : w;
          if (probe2.measureText(next).width > inner - 12 && cur) {
            out.push(cur);
            cur = w;
          } else cur = next;
        }
        if (cur) out.push(cur);
        return out;
      });
      for (const ls of lines) bh += ls.length * 15 + 3;
      bh += 8;
      if (!dry) {
        ctx.fillStyle = WARN_SOFT;
        ctx.beginPath();
        ctx.roundRect(bx, y, bw2, bh, 8);
        ctx.fill();
      }
      let yy = y + 12;
      text(L.why, bx + 12, yy + 10, 12, 600, WARN_INK);
      yy += 22;
      for (const ls of lines) {
        text('•', bx + 14, yy + 9, 11, 400, WARN_INK);
        ls.forEach((ln, i) => text(ln, bx + 24, yy + 9 + i * 15, 11, 400, WARN_INK));
        yy += ls.length * 15 + 3;
      }
      y += bh + 14;
      dash(y);
      y += 20;
    }

    // ตัวเลขใหญ่
    if (lead && show.headline) {
      const isIn = lead.dir === 'in';
      text(lead.approve ? L.approved : isIn ? L.received : L.sent, W / 2, y + 4, 12, 400, MUTED, 'center');
      // ป้าย → ตัวเลขใหญ่ ชิดกัน (~6px) ให้อ่านเป็นก้อนเดียว
      y += 6;
      const amount = `${lead.approve ? '' : isIn ? '+' : '−'}${formatAmountFull(lead.amount)}`;
      // ตัวเลขอย่างเดียว ไม่มีสัญลักษณ์ (บล็อกสินทรัพย์ข้างล่างบอกอยู่แล้ว) — ยาวเกินจะถูกย่อใน text() ไม่ตัดบรรทัด
      text(amount, W / 2, y + 26, 26, 700, risky ? MUTED : isIn ? POSITIVE : INK, 'center');
      y += 36;
      if (show.usd && lead.usd !== null && lead.usd !== undefined) {
        text(`≈ ${formatUsdExact(lead.usd)}`, W / 2, y + 4, 12, 400, MUTED, 'center');
        y += 16;
      }
      y += 6;
      dash(y);
      y += 16;
    }

    // บล็อกสินทรัพย์: โลโก้โทเคน 36 + ตราเชน 14 / สัญลักษณ์ + on เชน / จำนวน (สีหมึก) + USD
    (show.assets ? ordered : []).forEach((m) => {
      if (!dry) {
        // เหรียญพื้นเมือง (ไม่มีโลโก้ของตัวเอง) → ใช้โลโก้เชน
        circleImage(ctx, moveImgs[d.moves.indexOf(m)] ?? (m.native ? chainImg : null), PAD, y, 36, m.symbol, `hsl(${identiconHue(m.symbol)} 60% 52%)`);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(PAD + 29, y + 29, 9, 0, Math.PI * 2);
        ctx.fill();
        circleImage(ctx, chainImg, PAD + 22, y + 22, 14, d.chainName, INK);
      }
      text(m.symbol, PAD + 46, y + 16, 14, 600);
      if (risky && !dry) {
        // สามเหลี่ยมแดงเล็กหลังสัญลักษณ์
        ctx.font = `600 14px ${FONT}`;
        const sx = PAD + 46 + ctx.measureText(m.symbol).width + 8;
        ctx.strokeStyle = DANGER;
        ctx.lineWidth = 1.5;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(sx + 6, y + 5);
        ctx.lineTo(sx + 12, y + 16);
        ctx.lineTo(sx, y + 16);
        ctx.closePath();
        ctx.moveTo(sx + 6, y + 9.5);
        ctx.lineTo(sx + 6, y + 12.5);
        ctx.stroke();
        ctx.fillStyle = DANGER;
        ctx.fillRect(sx + 5.3, y + 13.6, 1.4, 1.4);
      }
      text(`${L.on} ${d.chainName}`, PAD + 46, y + 31, 11, 400, MUTED);
      // แถวสินทรัพย์: 4 ทศนิยม (เหมือนแผงขวา) — ทศนิยมเต็มอยู่ที่ตัวเลขใหญ่ Received/Sent ด้านบนเท่านั้น
      text(`${m.approve ? '' : m.dir === 'in' ? '+' : '−'}${formatAmountShort(m.amount)}`, W - PAD, y + 16, 15, 600, INK, 'right');
      if (show.usd && m.usd !== null && m.usd !== undefined) text(formatUsdExact(m.usd), W - PAD, y + 31, 11, 400, MUTED, 'right');
      y += 46;
    });
    if (show.assets && ordered.length) y += 4;
    if (show.fee && d.fee !== null) kv(L.fee, `${formatFeeNative(d.fee, d.feeSymbol)}${d.feeUsd !== null && d.feeUsd !== undefined ? ` (${formatFeeUsd(d.feeUsd)})` : ''}`);
    const midBlock = (show.assets && ordered.length > 0) || (show.fee && d.fee !== null);
    if (midBlock) {
      y += 2;
      dash(y);
      y += 16;
    }

    // Wallet / From / To / Status
    const y0 = y;
    // ชื่อกระเป๋า (Main / BETA 24) ซ่อนแยกได้ — เหลือแค่ที่อยู่ย่อ
    if (show.wallet) kv(L.wallet, show.walletLabel && d.walletLabel ? `${d.walletLabel} · ${shortAddr(d.wallet)}` : shortAddr(d.wallet));
    // from/to ที่เป็นกระเป๋าที่ตั้งชื่อไว้ → "ชื่อ · 0x…" (ปิด Wallet name แล้วเหลือแค่ที่อยู่)
    const named = (addr: string, label: string | null | undefined) => (show.walletLabel && label ? `${label} · ${shortAddr(addr)}` : shortAddr(addr));
    // แสดง From / To เสมอ แม้จะเป็นกระเป๋าเดียวกับแถว Wallet — สลิปต้องบอกทิศทางครบทั้งสองฝั่ง
    if (show.wallet && d.from) kv(L.from, named(d.from, d.fromLabel));
    if (show.protocol && d.protocol) kv(d.protocolKind ?? L.protocol, d.protocol);
    if (show.to && d.to) kv(L.to, named(d.to, d.toLabel));
    if (show.status) kv(L.status, ok ? `${L.statusOk} ✓` : `${L.statusFailed} ✗`);
    if (y > y0) {
      y += 2;
      dash(y);
      y += 18;
    }

    // hash เต็ม (ตัดบรรทัด) กลาง
    if (show.hash) y += wrap(d.hash, W / 2, y + 8, 10, W - PAD * 2, 400, MUTED, 'center') + 8;
    // QR กลาง
    if (show.qr) {
      if (!dry) {
        if (risky) ctx.globalAlpha = 0.3;
        ctx.drawImage(qr, W / 2 - 48, y, 96, 96);
        ctx.globalAlpha = 1;
        if (risky) {
          // ป้าย "Verify first" ทับกลาง QR
          ctx.font = `600 10px ${FONT}`;
          const lw = ctx.measureText(L.verifyFirst).width + 14;
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = DANGER;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.roundRect(W / 2 - lw / 2, y + 39, lw, 18, 4);
          ctx.fill();
          ctx.stroke();
          text(L.verifyFirst, W / 2, y + 52, 10, 600, DANGER, 'center');
        }
      }
      y += 116;
    }
    if (show.code) {
      text(L.code, W / 2, y + 4, 11, 400, MUTED, 'center');
      y += 20;
      text(rec.code, W / 2, y + 4, 15, 600, INK, 'center');
      y += 22;
    }
    if (show.issued) {
      text(`${L.issued} ${formatStamp(Math.floor(d.issued / 1000))}`, W / 2, y + 4, 10, 400, MUTED, 'center');
      y += 16;
    }

    // ตราฟังก์ชันที่ทำกับสลิปนี้ (Downloaded ⤓ / Verified ✓ …) — สีประจำฟังก์ชัน
    if (action) {
      const color = tokenColor(`fn-${action}`, FN_FALLBACK[action]);
      ctx.font = `600 12px ${FONT}`;
      const label = `${L.action[action]} ${FN_GLYPH[action]}`;
      const lw = ctx.measureText(label).width + 24;
      if (!dry) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(W / 2 - lw / 2, y + 8, lw, 26, 13);
        ctx.stroke();
      }
      text(label, W / 2, y + 25, 12, 600, color, 'center');
      y += 40;
    }
    y += 22;
    return y;
  };

  const probe = document.createElement('canvas').getContext('2d')!;
  const H = Math.ceil(draw(probe, true)) + SCALLOP_R;
  const canvas = document.createElement('canvas');
  canvas.width = W * 2;
  canvas.height = H * 2;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(2, 2);
  // กระดาษขาว ขอบล่างหยัก (ครึ่งวงกลมเว้า) — นอกนั้นโปร่งใส
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(W, 0);
  ctx.lineTo(W, H - SCALLOP_R);
  for (let x = W; x > 0; x -= SCALLOP_STEP) ctx.arc(x - SCALLOP_STEP / 2, H - SCALLOP_R, SCALLOP_R, 0, Math.PI, true);
  ctx.lineTo(0, H - SCALLOP_R);
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  if (risky) {
    // แถบเตือนเหลือง/ขาวเฉียงบนหัวสลิป
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, 8);
    ctx.clip();
    ctx.fillStyle = WARN;
    for (let x = -20; x < W + 20; x += 20) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 10, 0);
      ctx.lineTo(x + 2, 8);
      ctx.lineTo(x - 8, 8);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
  draw(ctx, false);
  ctx.restore();
  return { canvas, texts, width: W, height: H };
}

export function canvasBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('blob'))), 'image/png'));
}
