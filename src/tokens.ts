/**
 * metadata โทเคน (ชื่อ/สัญลักษณ์/โลโก้) จาก URL ที่ผู้ใช้ตั้งต่อแหล่ง — ขอเป็นชุด ชุดละ ≤50 ที่อยู่ เว้น 1.5 วิระหว่างชุด
 * จำลง localStorage 7 วัน; ที่อยู่ที่แหล่งไม่รู้จักก็จำไว้ (ว่าง) จะได้ไม่ขอซ้ำทุกครั้ง
 */
import { parseTokenMeta, type TokenMeta } from './feed';
import { requestUrl } from './proxy';
import { limitedFetch } from './limiter';
import type { Endpoint } from './store';

const KEY = 'xcap.scan.tokens';
const TTL = 7 * 24 * 60 * 60 * 1000;
/* ชุดละ 20 ที่อยู่ — แหล่งที่เป็น endpoint ค้นหามักตัดผลลัพธ์เมื่อคิวรียาวเกิน ชุดเล็กจึงได้ครบกว่า */
const BATCH = 20;
const GAP_MS = 1500;

type Entry = TokenMeta & { t: number };
let cache: Record<string, Entry> | null = null;
let chain: Promise<void> = Promise.resolve();

function load(): Record<string, Entry> {
  if (cache) return cache;
  cache = {};
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const now = Date.now();
      for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, Entry>)) if (now - v.t < TTL) cache[k] = v;
    }
  } catch {
    /* ไม่มี storage */
  }
  return cache;
}

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache ?? {}));
  } catch {
    /* เต็มหรือถูกบล็อก */
  }
}

/** URL ชุด: มี {addresses} → แทนที่; พารามิเตอร์ว่างที่วางมา (?query= / ?tokenAddresses=) → เติมตรงนั้น; ไม่มีเลย → ต่อ tokenAddresses=… ให้ */
export function metaUrl(tpl: string, addresses: string[]): string {
  const u = tpl.trim();
  // คั่นด้วย %2C (คอมมาเข้ารหัส) ตามที่แหล่งส่วนใหญ่รับ
  const joined = addresses.map(encodeURIComponent).join('%2C');
  if (u.includes('{addresses}')) return u.replaceAll('{addresses}', joined);
  // วางมาเป็น ?tokenAddresses= (ว่าง) → เติมตรงนั้น ไม่ต่อซ้ำ
  const empty = /([?&](?:tokenAddresses|query|ids|addresses|mints))(=?)(?=&|$)/;
  if (empty.test(u)) return u.replace(empty, `$1=${joined}`);
  const sep = u.endsWith('?') || u.endsWith('&') ? '' : u.includes('?') ? '&' : '?';
  return `${u}${sep}tokenAddresses=${joined}`;
}

export function tokenMetaOf(addr: string): TokenMeta | null {
  const e = load()[addr];
  return e ? { name: e.name, symbol: e.symbol, decimals: e.decimals, logo: e.logo } : null;
}

/** คืน metadata ของทุกที่อยู่ที่รู้ (จากแคช + ที่ขอใหม่) — คำขอต่อคิวกันทั้งแอป ไม่ยิงพร้อมกัน */
export async function ensureTokenMeta(ep: Endpoint, addresses: string[]): Promise<Map<string, TokenMeta>> {
  const out = new Map<string, TokenMeta>();
  if (!ep.metaUrl) return out;
  const c = load();
  const missing: string[] = [];
  for (const a of new Set(addresses)) {
    const e = c[a];
    if (e) {
      if (e.name || e.symbol || e.logo || e.decimals !== null) out.set(a, e);
    } else missing.push(a);
  }
  if (!missing.length) return out;
  const headers: Record<string, string> = { accept: 'application/json' };
  if (ep.authHeader && ep.apiKey) headers[ep.authHeader] = ep.apiKey;
  const batches: string[][] = [];
  for (let i = 0; i < missing.length; i += BATCH) batches.push(missing.slice(i, i + BATCH));
  const run = async () => {
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]!;
      try {
        const res = await limitedFetch(requestUrl(metaUrl(ep.metaUrl!, batch)), { headers });
        if (res.status === 429) return;
        if (!res.ok) continue;
        const meta = parseTokenMeta(await res.json());
        const now = Date.now();
        for (const a of batch) {
          const m = meta.get(a) ?? { name: null, symbol: null, decimals: null, logo: null };
          c[a] = { ...m, t: now };
          if (m.name || m.symbol || m.logo || m.decimals !== null) out.set(a, m);
        }
        save();
      } catch {
        /* เครือข่าย — ปล่อยให้ที่อยู่นี้ยังไม่รู้ ลองใหม่ครั้งหน้า */
      }
      if (i + 1 < batches.length) await new Promise((r) => setTimeout(r, GAP_MS));
    }
  };
  chain = chain.then(run, run);
  await chain;
  return out;
}
