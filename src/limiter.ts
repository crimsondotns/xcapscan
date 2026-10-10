import { fallbackProxy } from './proxy';
/**
 * คิวคำขอกันโดน rate limit (429)
 *
 * - ยิงพร้อมกันไม่เกิน 2 คำขอ เว้นอย่างน้อย 500ms ระหว่างคำขอ
 * - คำขอ URL เดียวกันที่ค้างอยู่ ใช้ผลร่วมกัน (กดโหลดซ้ำ/หลายจอถามพร้อมกัน จะไม่กลายเป็นหลายคำขอ)
 * - โดน 429 → ไม่พักคิว (ผู้ใช้ 2026-10-10) แค่ตั้งธง limited() ให้ฟีเจอร์ที่โหลดเองหยุด ไม่ fetch อัตโนมัติต่อ
 *   พร้อม "บีบท่อ" ลงเหลือ 1 คำขอต่อครั้งและถ่างระยะห่างขึ้น แล้วค่อยๆ คลายเมื่อสำเร็จติดกันหลายครั้ง
 *   (แหล่งข้อมูลส่วนใหญ่ไม่ได้ดูแค่จำนวนคำขอ แต่ดูความถี่ด้วย ยิงถี่ตอนเพิ่งโดนแบนคือต่ออายุแบนให้ตัวเอง)
 * - ไม่ยิงซ้ำเอง (ผู้ใช้ 2026-10-01): คืน 429 ให้ผู้เรียกทันที — ยิงซ้ำตอนโดนแบนคือต่ออายุแบน;
 *   ผู้ใช้กดโหลดต่อเอง → resumeNow() ล้างธง
 * - ต่อ host (ผู้ใช้ 2026-10-03 "ไม่อยากโดน 429 เลย"): แหล่งฟรียอมให้ยิงติดกันราว 7 คำขอแล้วบล็อกทั้ง host ~9 นาที
 *   → ถังโทเคนต่อ host: ติดกันได้ HOST_BURST คำขอ แล้วเติม 1 ทุก HOST_REFILL_MS (คำขอที่เกินรอคิว ไม่ยิงออกไป)
 * - ไม่ล็อก host หลังโดน 429 (ผู้ใช้ 2026-10-10: เปลี่ยน IP ก็ปลดบล็อกแล้ว) — ผู้ใช้กด "ลองใหม่" → resumeNow() ล้างเวลาพักของคิว
 */
const MAX_CONCURRENCY = 2;
/** สำเร็จติดกันกี่ครั้งถึงคลายท่อขึ้นหนึ่งขั้น */
const RECOVER_AFTER = 6;
let GAP_MS = 500;
const MAX_GAP_FACTOR = 8;
let HOST_BURST = 4;
let HOST_REFILL_MS = 3000;

let active = 0;
let lastStart = 0;
/** โดน 429 และผู้ใช้ยังไม่กดลองใหม่ — ฟีเจอร์ที่โหลดเองต้องหยุด */
let limitedFlag = false;
/** จำนวนที่ยอมให้ยิงพร้อมกันตอนนี้ (บีบลงเมื่อโดน 429) */
let limit = MAX_CONCURRENCY;
/** ตัวคูณระยะห่างระหว่างคำขอตอนนี้ */
let gapFactor = 1;
let goodRun = 0;
const waiting: Array<() => void> = [];

/** เทสต์เท่านั้น: ย่นเวลารอ และคืนค่าสภาพท่อให้เริ่มใหม่สะอาดๆ */
export function setLimiterTiming(t: { gapMs?: number; reset?: boolean; hostBurst?: number; hostRefillMs?: number }): void {
  if (t.gapMs !== undefined) GAP_MS = t.gapMs;
  if (t.hostBurst !== undefined) HOST_BURST = t.hostBurst;
  if (t.hostRefillMs !== undefined) HOST_REFILL_MS = t.hostRefillMs;
  if (t.reset) {
    buckets.clear();
    gapFactor = 1;
    limit = MAX_CONCURRENCY;
    goodRun = 0;
    limitedFlag = false;
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
/* เวลาพักต่อ host เดิม (ถูกเอาออก) — ล้างค่าที่ค้างในเครื่องผู้ใช้ */
try {
  localStorage.removeItem('xcap:limiter:hostPause');
  localStorage.removeItem('xcap:limiter:pausedUntil');
} catch {
  /* ไม่มี storage */
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
async function acquire(): Promise<void> {
  while (active >= limit) await new Promise<void>((r) => waiting.push(r));
  active++;
  for (;;) {
    const now = Date.now();
    const wait = lastStart + GAP_MS * gapFactor - now;
    if (wait <= 0) break;
    await sleep(wait);
  }
  lastStart = Date.now();
}

function release(): void {
  active--;
  waiting.shift()?.();
}

/** โดน 429 — ตั้งธง limited() แล้วบีบท่อให้แคบลง (ไม่พักคิว) */
export function backoff(): void {
  limitedFlag = true;
  limit = 1;
  gapFactor = Math.min(gapFactor * 2, MAX_GAP_FACTOR);
  goodRun = 0;
}

/** สำเร็จติดกันพอสมควร → คลายท่อขึ้นทีละขั้น (ไม่กระโดดกลับไปเต็มที่ทันที) */
function loosen(): void {
  if (++goodRun < RECOVER_AFTER) return;
  goodRun = 0;
  if (gapFactor > 1) gapFactor = Math.max(1, gapFactor / 2);
  else if (limit < MAX_CONCURRENCY) limit++;
}

async function run(url: string, init?: RequestInit): Promise<Response> {
  const host = hostOf(url);
  await hostSlot(host);
  await acquire();
  try {
    try {
      const res = await fetch(url, init);
      if (res.status === 429) {
        backoff();
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
  // มีแต่คำขออ่านอย่างเดียวในแอปนี้ คำขอที่ URL+header+body เหมือนกันจึงใช้ผลร่วมกันได้ (eth_call ของ RPC เป็น POST)
  const key = `${url}|${JSON.stringify(init?.headers ?? {})}|${typeof init?.body === 'string' ? init.body : ''}`;
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

/** โดน 429 แล้วยังไม่มีใครกดลองใหม่ — ฟีเจอร์ที่ fetch อัตโนมัติต้องหยุด */
export function limited(): boolean {
  return limitedFlag;
}

/** ผู้ใช้กดลองใหม่ (เช่น เพิ่งเปลี่ยน IP) — ล้างธง ท่อยังแคบอยู่แล้วค่อยคลายเอง */
export function resumeNow(): void {
  limitedFlag = false;
  buckets.clear();
}