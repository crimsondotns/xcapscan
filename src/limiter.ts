import { fallbackProxy } from './proxy';
/**
 * คิวคำขอกันโดน rate limit (429)
 *
 * - ยิงพร้อมกันไม่เกิน 2 คำขอ เว้นอย่างน้อย 500ms ระหว่างคำขอ
 * - คำขอ URL เดียวกันที่ค้างอยู่ ใช้ผลร่วมกัน (กดโหลดซ้ำ/หลายจอถามพร้อมกัน จะไม่กลายเป็นหลายคำขอ)
 * - โดน 429 → หยุด "ทั้งคิว" (ตาม Retry-After ถ้ามี ไม่มีก็ 5s แล้วเพิ่มเป็น 2 เท่า สูงสุด 60s)
 *   พร้อม "บีบท่อ" ลงเหลือ 1 คำขอต่อครั้งและถ่างระยะห่างขึ้น แล้วค่อยๆ คลายเมื่อสำเร็จติดกันหลายครั้ง
 *   (แหล่งข้อมูลส่วนใหญ่ไม่ได้ดูแค่จำนวนคำขอ แต่ดูความถี่ด้วย ยิงถี่ตอนเพิ่งโดนแบนคือต่ออายุแบนให้ตัวเอง)
 * - ไม่ยิงซ้ำเอง (ผู้ใช้ 2026-10-01): คืน 429 ให้ผู้เรียกทันที — ยิงซ้ำตอนโดนแบนคือต่ออายุแบน;
 *   UI โชว์เวลานับถอยหลังจาก pausedFor() แล้วให้ผู้ใช้กดโหลดต่อเอง
 * - ซิงก์เวลาพักข้ามแท็บผ่าน localStorage — เปิดแท็บใหม่ระหว่างที่แท็บอื่นพักอยู่ จะไม่ยิงซ้ำ
 * - ต่อ host (ผู้ใช้ 2026-10-03 "ไม่อยากโดน 429 เลย"): แหล่งฟรียอมให้ยิงติดกันราว 7 คำขอแล้วบล็อกทั้ง host ~9 นาที
 *   → ถังโทเคนต่อ host: ติดกันได้ HOST_BURST คำขอ แล้วเติม 1 ทุก HOST_REFILL_MS (คำขอที่เกินรอคิว ไม่ยิงออกไป)
 *   → ถ้ายังโดน 429: พัก host นั้น HOST_PAUSE_MS (≥ เวลาบล็อกจริง) จำข้ามรีเฟรช ระหว่างพักคืน 429 ทันทีโดยไม่ยิงจริง
 *     (ไม่ต่ออายุบล็อก) — host อื่นยังใช้ได้ตามปกติ
 */
const MAX_CONCURRENCY = 2;
/** สำเร็จติดกันกี่ครั้งถึงคลายท่อขึ้นหนึ่งขั้น */
const RECOVER_AFTER = 6;
let GAP_MS = 500;
let BASE_PAUSE_MS = 30000;
const MAX_PAUSE_MS = 300000;
const MAX_GAP_FACTOR = 8;
let HOST_BURST = 4;
let HOST_REFILL_MS = 3000;
let HOST_PAUSE_MS = 10 * 60_000;
const LS_HOST_KEY = 'xcap:limiter:hostPause';

/** คีย์ใน localStorage สำหรับซิงก์เวลาพักข้ามแท็บ (ทุกแท็บในเบราว์เซอร์เดียวกันใช้เน็ตเดียวกัน) */
const LS_PAUSE_KEY = 'xcap:limiter:pausedUntil';

let active = 0;
let lastStart = 0;
let pausedUntil = 0;
let strikes = 0;
/** จำนวนที่ยอมให้ยิงพร้อมกันตอนนี้ (บีบลงเมื่อโดน 429) */
let limit = MAX_CONCURRENCY;
/** ตัวคูณระยะห่างระหว่างคำขอตอนนี้ */
let gapFactor = 1;
let goodRun = 0;
const waiting: Array<() => void> = [];

/* โหลดค่าที่ค้างไว้จาก localStorage (เช่น เปิดแท็บใหม่ระหว่างที่แท็บอื่นพักอยู่) */
try {
  const saved = localStorage.getItem(LS_PAUSE_KEY);
  if (saved) pausedUntil = Number(saved) || 0;
} catch {
  /* localStorage ใช้ไม่ได้ (โหมดส่วนตัว) → เก็บในหน่วยความจำอย่างเดียว */
}

/* แท็บอื่น prolong เวลา → รับรู้ทันที ไม่ต้องรอจังหวะ pausedFor() */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== LS_PAUSE_KEY || !e.newValue) return;
    const v = Number(e.newValue) || 0;
    if (v > pausedUntil) pausedUntil = v;
  });
}

function persistPausedUntil(): void {
  try {
    localStorage.setItem(LS_PAUSE_KEY, String(pausedUntil));
  } catch {
    /* ignore */
  }
}

function clearPausedUntil(): void {
  pausedUntil = 0;
  try {
    localStorage.removeItem(LS_PAUSE_KEY);
  } catch {
    /* ignore */
  }
}

/** เทสต์เท่านั้น: ย่นเวลารอ และคืนค่าสภาพท่อให้เริ่มใหม่สะอาดๆ */
export function setLimiterTiming(t: { gapMs?: number; basePauseMs?: number; reset?: boolean; hostBurst?: number; hostRefillMs?: number; hostPauseMs?: number }): void {
  if (t.gapMs !== undefined) GAP_MS = t.gapMs;
  if (t.basePauseMs !== undefined) BASE_PAUSE_MS = t.basePauseMs;
  if (t.hostBurst !== undefined) HOST_BURST = t.hostBurst;
  if (t.hostRefillMs !== undefined) HOST_REFILL_MS = t.hostRefillMs;
  if (t.hostPauseMs !== undefined) HOST_PAUSE_MS = t.hostPauseMs;
  if (t.reset) {
    buckets.clear();
    hostPause.clear();
    saveHostPause();
    strikes = 0;
    gapFactor = 1;
    limit = MAX_CONCURRENCY;
    goodRun = 0;
    clearPausedUntil();
  }
}

/**
 * คำขออ่านที่ยังค้างอยู่ ต่อ URL — ใช้ผลร่วมกันแทนที่จะยิงซ้ำ
 * สำเนาถูกทำทันทีที่คำตอบมาถึง (ก่อนใครอ่าน body) เพราะ Response อ่านได้ครั้งเดียว
 */
interface Shared {
  promise: Promise<Response>;
  waiters: number;
  copies: Response[];
}
const inflight = new Map<string, Shared>();

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/* ---------- ต่อ host ---------- */

/** host จริงของคำขอ — URL ที่ห่อด้วย proxy (/__proxy?url=… หรือ proxy ของผู้ใช้) ดึง URL ข้างในออกมา */
export function hostOf(url: string): string {
  const inner = /https?%3A%2F%2F[^&]+/i.exec(url);
  try {
    return new URL(inner ? decodeURIComponent(inner[0]) : url, 'http://local').host;
  } catch {
    return '';
  }
}

const buckets = new Map<string, { tokens: number; at: number }>();
const hostPause = new Map<string, number>();
try {
  const raw = localStorage.getItem(LS_HOST_KEY);
  if (raw) for (const [h, v] of Object.entries(JSON.parse(raw) as Record<string, number>)) if (v > Date.now()) hostPause.set(h, v);
} catch {
  /* ไม่มี storage */
}
function saveHostPause(): void {
  try {
    const now = Date.now();
    const o: Record<string, number> = {};
    for (const [h, v] of hostPause) if (v > now) o[h] = v;
    if (Object.keys(o).length) localStorage.setItem(LS_HOST_KEY, JSON.stringify(o));
    else localStorage.removeItem(LS_HOST_KEY);
  } catch {
    /* ignore */
  }
}
function syncHostPause(): void {
  try {
    const raw = localStorage.getItem(LS_HOST_KEY);
    if (raw) for (const [h, v] of Object.entries(JSON.parse(raw) as Record<string, number>)) if (v > (hostPause.get(h) ?? 0)) hostPause.set(h, v);
  } catch {
    /* ignore */
  }
}
/** เวลาที่ host นี้ยังถูกพัก (ms) */
export function hostPausedFor(host: string): number {
  syncHostPause();
  return Math.max(0, (hostPause.get(host) ?? 0) - Date.now());
}
function pauseHost(host: string, ms: number): void {
  if (!host) return;
  hostPause.set(host, Math.max(hostPause.get(host) ?? 0, Date.now() + ms));
  saveHostPause();
}
/** รอจนถังของ host มีโทเคน (ยิงติดกันได้ HOST_BURST แล้วเติมทีละ 1 ทุก HOST_REFILL_MS) */
async function hostSlot(host: string): Promise<void> {
  if (!host) return;
  for (;;) {
    const now = Date.now();
    const b = buckets.get(host) ?? { tokens: HOST_BURST, at: now };
    b.tokens = Math.min(HOST_BURST, b.tokens + (now - b.at) / HOST_REFILL_MS);
    b.at = now;
    buckets.set(host, b);
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return;
    }
    await sleep(Math.ceil((1 - b.tokens) * HOST_REFILL_MS));
  }
}
/** คำตอบ 429 ที่ไม่ได้ยิงจริง — host ยังถูกพักอยู่ (ไม่ต่ออายุบล็อก) */
const pausedResponse = () => new Response('{"message":"paused"}', { status: 429, headers: { 'content-type': 'application/json' } });

async function acquire(): Promise<void> {
  while (active >= limit) await new Promise<void>((r) => waiting.push(r));
  active++;
  for (;;) {
    const now = Date.now();
    const wait = Math.max(pausedUntil - now, lastStart + GAP_MS * gapFactor - now);
    if (wait <= 0) break;
    await sleep(wait);
  }
  lastStart = Date.now();
}

function release(): void {
  active--;
  waiting.shift()?.();
}

/** แหล่งบอกให้รอ (429) — หยุดคิวทั้งหมด แล้วบีบท่อให้แคบลง + ซิงก์ข้ามแท็บ */
export function backoff(retryAfterHeader: string | null): number {
  const hinted = retryAfterHeader ? Number(retryAfterHeader) * 1000 : NaN;
  const ms = Number.isFinite(hinted) && hinted > 0 ? Math.min(hinted, MAX_PAUSE_MS) : Math.min(BASE_PAUSE_MS * 2 ** strikes, MAX_PAUSE_MS);
  strikes = Math.min(strikes + 1, 4);
  pausedUntil = Math.max(pausedUntil, Date.now() + ms);
  persistPausedUntil();
  limit = 1;
  gapFactor = Math.min(gapFactor * 2, MAX_GAP_FACTOR);
  goodRun = 0;
  return ms;
}

/** สำเร็จติดกันพอสมควร → คลายท่อขึ้นทีละขั้น (ไม่กระโดดกลับไปเต็มที่ทันที) */
function loosen(): void {
  strikes = Math.max(0, strikes - 1);
  if (++goodRun < RECOVER_AFTER) return;
  goodRun = 0;
  if (gapFactor > 1) gapFactor = Math.max(1, gapFactor / 2);
  else if (limit < MAX_CONCURRENCY) limit++;
}

async function run(url: string, init?: RequestInit): Promise<Response> {
  const host = hostOf(url);
  if (hostPausedFor(host) > 0) return pausedResponse();
  await hostSlot(host);
  if (hostPausedFor(host) > 0) return pausedResponse();
  await acquire();
  try {
    try {
      const res = await fetch(url, init);
      if (res.status === 429) {
        const ra = Number(res.headers.get('retry-after')) * 1000;
        pauseHost(host, Math.max(HOST_PAUSE_MS, Number.isFinite(ra) ? ra : 0));
        // บีบท่อรวม: เช็กเฉพาะเวลาพักรวม (pausedFor รวมเวลาพัก host ที่เพิ่งตั้งไปแล้ว)
        if (pausedUntil <= Date.now()) backoff(res.headers.get('retry-after'));
      } else if (res.ok) loosen();
      return res;
    } catch (e) {
      // ยิงตรงโดน CORS/เครือข่ายบล็อก → ลองผ่าน proxy ของ dev (ถ้ามี) ก่อนยอมแพ้
      const alt = fallbackProxy(url);
      if (!alt) throw e;
      return await fetch(alt, init);
    }
  } finally {
    release();
  }
}

/** ยิงผ่านคิว; 429 → พักทั้งคิว + บีบท่อ แล้วคืน 429 ให้ผู้เรียกทันที (ไม่ยิงซ้ำเอง) */
export async function limitedFetch(url: string, init?: RequestInit): Promise<Response> {
  // มีแต่คำขออ่านอย่างเดียวในแอปนี้ คำขอที่ URL+header เหมือนกันจึงใช้ผลร่วมกันได้
  const key = `${url}|${JSON.stringify(init?.headers ?? {})}`;
  const shared = inflight.get(key);
  if (shared) {
    const mine = shared.waiters++;
    await shared.promise;
    return shared.copies[mine] ?? shared.promise;
  }
  const entry: Shared = { waiters: 0, copies: [], promise: Promise.resolve(new Response()) };
  entry.promise = run(url, init).then((res) => {
    // ทำสำเนาให้ผู้รอทุกคนตรงนี้ — ถ้ารอให้แต่ละคนไป clone เอง คนแรกอาจอ่าน body ไปแล้ว
    entry.copies = typeof res.clone === 'function' ? Array.from({ length: entry.waiters }, () => res.clone()) : [];
    return res;
  });
  inflight.set(key, entry);
  try {
    return await entry.promise;
  } finally {
    inflight.delete(key);
  }
}

/** ให้เทสต์/ฟีเจอร์อื่นดูว่าตอนนี้ถูกพักอยู่ไหม — อ่านจาก localStorage ด้วย แท็บอื่น prolong ได้ */
export function pausedFor(): number {
  try {
    const saved = localStorage.getItem(LS_PAUSE_KEY);
    if (saved) {
      const v = Number(saved) || 0;
      if (v > pausedUntil) pausedUntil = v;
    }
  } catch {
    /* ignore */
  }
  syncHostPause();
  const now = Date.now();
  let host = 0;
  for (const v of hostPause.values()) host = Math.max(host, v - now);
  return Math.max(0, pausedUntil - now, host);
}