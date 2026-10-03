/**
 * ยอดคงเหลือ EVM ผ่าน RPC สาธารณะ (ผู้ใช้ 2026-10-03 — ลดคำขอไปแหล่งเดิม ไม่โดน 429)
 * - รายการ RPC มาจาก URL ที่ตั้งตอน build (VITE_RPC_LIST_URL) ไม่มี host ใดฝังในโค้ด: [{ chainId, rpc: [url | { url }] }]
 * - RPC บอกไม่ได้ว่ากระเป๋าถือโทเคนอะไร → ใช้ "รายชื่อโทเคน" จากผลของแหล่งเดิมครั้งล่าสุด (balances.ts) แล้วถามแค่จำนวนใหม่
 * - ทั้งเชนใช้ eth_call ไปที่ Multicall3 ครั้งเดียว (balanceOf ของทุกโทเคน + getEthBalance ของเหรียญหลัก)
 * - RPC ตัวหนึ่งพัง/429 → ลองตัวถัดไปของเชนนั้น; หมดทุกตัว → เชนนั้นคืน null ให้ผู้เรียกไปใช้แหล่งเดิม
 */
import { limitedFetch } from './limiter';
import { requestUrl } from './proxy';
import { configuredRpcListUrl } from './config';

/** chainId → URL ของ RPC (https เท่านั้น ไม่มีตัวที่ต้องใส่กุญแจ) */
export type RpcMap = Map<number, string[]>;

const KEY = 'xcap.scan.rpcs';
const TTL = 24 * 3600 * 1000;
/** ลองต่อเชนได้ไม่เกินเท่านี้ ก่อนยอมแพ้ไปใช้แหล่งเดิม */
const MAX_TRIES = 3;
/** โทเคนต่อ eth_call หนึ่งครั้ง */
const CHUNK = 150;
export const MULTICALL3 = '0xca11bde05977b3631167028862be2a173976ca11';

type Dict = Record<string, unknown>;
const isObj = (v: unknown): v is Dict => typeof v === 'object' && v !== null && !Array.isArray(v);

/** แปลงรายการ RPC — ตัดตัวที่มีตัวแปรกุญแจ (${…}, API_KEY) และที่ไม่ใช่ https; ตัวที่ไม่ติดตามผู้ใช้ขึ้นก่อน */
export function parseRpcList(body: unknown, perChain = MAX_TRIES): RpcMap {
  const list = Array.isArray(body) ? body : isObj(body) && Array.isArray(body.data) ? body.data : [];
  const out: RpcMap = new Map();
  for (const c of list) {
    if (!isObj(c)) continue;
    const id = typeof c.chainId === 'string' ? Number(c.chainId) : c.chainId;
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0 || !Array.isArray(c.rpc)) continue;
    const ok: { url: string; none: boolean }[] = [];
    for (const r of c.rpc) {
      const url = typeof r === 'string' ? r : isObj(r) && typeof r.url === 'string' ? r.url : '';
      if (!/^https:\/\//i.test(url) || /\$\{|api[_-]?key|<|>/i.test(url)) continue;
      ok.push({ url, none: isObj(r) && r.tracking === 'none' });
    }
    ok.sort((a, b) => Number(b.none) - Number(a.none));
    const urls = [...new Set(ok.map((o) => o.url))].slice(0, perChain);
    if (urls.length) out.set(id, urls);
  }
  return out;
}

let loading: Promise<RpcMap | null> | null = null;

/** รายการ RPC (แคช localStorage 24 ชม.) — ไม่ได้ตั้ง URL / โหลดไม่ได้ = null (ใช้แหล่งเดิมอย่างเดียว) */
export function rpcList(url = configuredRpcListUrl()): Promise<RpcMap | null> {
  if (!url) return Promise.resolve(null);
  loading ??= (async () => {
    try {
      const hit = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { url: string; at: number; m: [number, string[]][] } | null;
      if (hit && hit.url === url && Date.now() - hit.at < TTL) return new Map(hit.m);
    } catch {
      /* ไม่มี storage */
    }
    try {
      const res = await limitedFetch(requestUrl(url), { headers: { accept: 'application/json' } });
      if (!res.ok) return null;
      const m = parseRpcList(await res.json());
      if (!m.size) return null;
      try {
        localStorage.setItem(KEY, JSON.stringify({ url, at: Date.now(), m: [...m] }));
      } catch {
        /* เต็ม — ใช้ในหน่วยความจำ */
      }
      return m;
    } catch {
      return null;
    }
  })();
  const p = loading;
  void p.then((m) => {
    if (!m) loading = null; // ล้มเหลว → ครั้งหน้าลองใหม่
  });
  return p;
}

/* ---------- ABI ของ Multicall3.aggregate3 ---------- */

const word = (n: number | bigint) => BigInt(n).toString(16).padStart(64, '0');
const addr = (a: string) => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');

export interface Call {
  target: string;
  /** calldata ไม่มี 0x */
  data: string;
}

export const balanceOfCall = (token: string, owner: string): Call => ({ target: token, data: `70a08231${addr(owner)}` });
export const nativeCall = (owner: string): Call => ({ target: MULTICALL3, data: `4d2301cc${addr(owner)}` });

/** aggregate3((address target, bool allowFailure, bytes callData)[]) — ทุกตัว allowFailure = true */
export function encodeAggregate3(calls: Call[]): string {
  const heads: string[] = [];
  const tails: string[] = [];
  let off = calls.length * 32;
  for (const c of calls) {
    const len = c.data.length / 2;
    const tail = addr(c.target) + word(1) + word(96) + word(len) + c.data.padEnd(Math.ceil(len / 32) * 64, '0');
    heads.push(word(off));
    tails.push(tail);
    off += tail.length / 2;
  }
  return `0x82ad56cb${word(32)}${word(calls.length)}${heads.join('')}${tails.join('')}`;
}

/** ผลของ aggregate3 → จำนวน (raw, ฐานสิบ) ต่อ call; call ที่ล้ม/ตอบผิดรูป = null */
export function decodeAggregate3(hex: string): (string | null)[] {
  const h = hex.replace(/^0x/, '');
  const at = (byte: number) => BigInt(`0x${h.slice(byte * 2, byte * 2 + 64) || '0'}`);
  const n = (byte: number) => Number(at(byte));
  const base = n(0);
  const count = n(base);
  const arr = base + 32;
  const out: (string | null)[] = [];
  for (let i = 0; i < count; i++) {
    const t = arr + n(arr + i * 32);
    const ok = at(t) !== 0n;
    const d = t + n(t + 32);
    out.push(ok && n(d) >= 32 ? at(d + 32).toString() : null);
  }
  return out;
}

/** eth_call ไป Multicall3 — ลอง RPC ทีละตัว; ทุกตัวล้ม = null */
async function multicall(urls: string[], calls: Call[]): Promise<(string | null)[] | null> {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: MULTICALL3, data: encodeAggregate3(calls) }, 'latest'] });
  for (const url of urls.slice(0, MAX_TRIES)) {
    try {
      const res = await limitedFetch(requestUrl(url), { method: 'POST', headers: { 'content-type': 'application/json' }, body });
      if (!res.ok) continue;
      const j = (await res.json()) as { result?: unknown };
      if (typeof j.result !== 'string' || j.result.length < 130) continue;
      const out = decodeAggregate3(j.result);
      if (out.length === calls.length) return out;
    } catch {
      /* CORS/เครือข่าย → ตัวถัดไป */
    }
  }
  return null;
}

/** จำนวน raw ของทุก call ในเชนเดียว (แบ่งชุดละ CHUNK) — ชุดไหนล้ม = ทั้งเชน null */
export async function chainBalances(urls: string[], calls: Call[]): Promise<(string | null)[] | null> {
  const out: (string | null)[] = [];
  for (let i = 0; i < calls.length; i += CHUNK) {
    const part = await multicall(urls, calls.slice(i, i + CHUNK));
    if (!part) return null;
    out.push(...part);
  }
  return out;
}
