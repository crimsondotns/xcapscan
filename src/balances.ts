/**
 * ยอดคงเหลือของกระเป๋า (ผู้ใช้ 2026-10-02) — ไม่มี host ใดฝังในโค้ด: ใช้ origin ของแหล่ง ERC-20 ที่ผู้ใช้วางเอง
 * (เหมือน chains.ts ที่ใช้ <origin>/v1/chain/list)
 *   1) <origin>/v1/user/used_chain_list?id={address}            → เชนที่กระเป๋านี้ใช้
 *   2) <origin>/v1/user/token_list?id={address}&is_all=true&chain_id={chain}  ต่อเชน → โทเคน + amount + price
 * กระเป๋า Solana (ผู้ใช้ 2026-10-02): origin ของแหล่ง Solana ตัวแรก → <origin>/v1/pnl-positions?address={address}&filter=recentlyActive
 *   → tokenPositions[] (balance, balanceValue) ชื่อ/สัญลักษณ์/โลโก้เติมจาก metaUrl ของแหล่ง (tokens.ts)
 * ทุกคำขอผ่าน limitedFetch; เจอ 429 หยุดทันที คืนเท่าที่ได้ (limited) — limiter พักคิวให้แล้ว
 * แคชยอด 10 นาที (หน่วยความจำ + localStorage); หลังจากนั้นกระเป๋า EVM รีเฟรชจำนวนผ่าน RPC สาธารณะ (rpc.ts) ไม่ยิงแหล่งเดิม
 */
import { useCallback, useEffect, useState } from 'react';
import { limitedFetch } from './limiter';
import { requestUrl } from './proxy';
import { ensureTokenMeta } from './tokens';
import { rememberPrice } from './prices';
import type { Endpoint, Wallet } from './store';
import { chainOf, type ChainMap } from './chains';
import { configuredRpcListUrl } from './config';
import { balanceOfCall, chainBalances, nativeCall, rpcList, type RpcMap } from './rpc';

export interface BalanceRow {
  chain: string;
  tokenId: string;
  symbol: string;
  name: string;
  logo: string | null;
  amount: number;
  price: number | null;
  usd: number | null;
  verified: boolean;
  /** จำนวนแบบทศนิยมครบทุกหลัก (สตริง ไม่ผ่าน float) — จาก raw_amount ÷ 10^decimals หรือข้อความตัวเลขดิบใน JSON; ไม่มี = null */
  exact?: string | null;
  /** ทศนิยมของโทเคน — มีเมื่อแหล่งส่งมา ใช้แปลงจำนวนดิบจาก RPC (rpc.ts) */
  decimals?: number;
}

export interface Balances {
  rows: BalanceRow[];
  /** เจอ 429 ระหว่างทาง — ได้ไม่ครบทุกเชน */
  limited: boolean;
  at: number;
}

/* ---------- ทศนิยมครบทุกหลัก (ผู้ใช้ 2026-10-02) ---------- */

/** ฟิลด์จำนวนที่ต้องเก็บข้อความตัวเลขดิบไว้ (JSON.parse แปลงเป็น float แล้วหลักท้ายหาย) */
const EXACT_KEYS = new Set(['amount', 'raw_amount', 'balance']);
/** JSON.parse ที่คืนฟิลด์จำนวนเป็นข้อความต้นฉบับ (source text access — เบราว์เซอร์ใหม่); ไม่รองรับก็ได้ number ตามเดิม */
export function parseJsonExact(text: string): unknown {
  return JSON.parse(text, function (this: unknown, key: string, value: unknown, ctx?: { source?: string }) {
    return typeof value === 'number' && EXACT_KEYS.has(key) && ctx?.source ? ctx.source : value;
  } as (this: unknown, key: string, value: unknown) => unknown);
}

const DEC_RE = /^-?\d+(\.\d+)?$/;
/** ข้อความทศนิยมธรรมดา (ไม่มี e) → สตริงมาตรฐาน; อย่างอื่น null */
const decText = (v: unknown): string | null => (typeof v === 'string' && DEC_RE.test(v.trim()) ? v.trim() : null);
const trimDec = (s: string) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);

/** จำนวนเต็มดิบ ÷ 10^decimals แบบสตริง */
export function fromRaw(raw: string, decimals: number): string | null {
  if (!/^\d+$/.test(raw) || !Number.isInteger(decimals) || decimals < 0 || decimals > 60) return null;
  const p = raw.padStart(decimals + 1, '0');
  return trimDec(decimals ? `${p.slice(0, p.length - decimals)}.${p.slice(p.length - decimals)}` : p).replace(/^0+(?=\d)/, '');
}

/** บวกทศนิยมแบบสตริง (BigInt) — ใช้รวมยอดหลายเชนโดยไม่เพี้ยน */
export function addDec(a: string, b: string): string {
  const [ai = '0', af = ''] = a.split('.');
  const [bi = '0', bf = ''] = b.split('.');
  const n = Math.max(af.length, bf.length);
  const sum = BigInt(ai + af.padEnd(n, '0')) + BigInt(bi + bf.padEnd(n, '0'));
  const neg = sum < 0n;
  const d = (neg ? -sum : sum).toString().padStart(n + 1, '0');
  return (neg ? '-' : '') + trimDec(n ? `${d.slice(0, d.length - n)}.${d.slice(d.length - n)}` : d);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const listOf = (j: unknown): unknown[] => (Array.isArray(j) ? j : isObj(j) && Array.isArray(j.data) ? j.data : []);

/** แหล่งตระกูลเดียวกับกระเป๋าตัวแรกที่เปิดอยู่ (ตามลำดับความสำคัญ) — ไม่มีแหล่ง = null */
export function balanceSource(endpoints: Endpoint[], wallet: Pick<Wallet, 'family'>): { ep: Endpoint; origin: string } | null {
  for (const ep of endpoints) {
    if (!ep.enabled || ep.family !== wallet.family) continue;
    try {
      return { ep, origin: new URL(ep.url).origin };
    } catch {
      /* URL เพี้ยน → ข้าม */
    }
  }
  return null;
}

const balancePath = (origin: string, kind: 'chains' | 'tokens') => `${origin}/v1/user/${kind === 'chains' ? 'used_chain_list' : 'token_list'}`;

export function parseChainIds(j: unknown): string[] {
  return [...new Set(listOf(j).flatMap((c) => (isObj(c) && str(c.id) ? [str(c.id)!] : [])))];
}

export function parseTokenList(j: unknown, chain: string): BalanceRow[] {
  const out: BalanceRow[] = [];
  for (const t of listOf(j)) {
    if (!isObj(t)) continue;
    const amount = num(t.amount);
    if (!amount) continue;
    const price = num(t.price);
    const symbol = str(t.optimized_symbol) ?? str(t.display_symbol) ?? str(t.symbol) ?? '?';
    const dec = num(t.decimals);
    const raw = typeof t.raw_amount === 'string' ? t.raw_amount.trim() : null;
    out.push({
      exact: (raw !== null && dec !== null ? fromRaw(raw, dec) : null) ?? decText(t.amount),
      chain: str(t.chain) ?? chain,
      tokenId: str(t.id) ?? symbol,
      symbol,
      name: str(t.name) ?? symbol,
      logo: str(t.logo_url),
      amount,
      price,
      usd: price !== null ? amount * price : null,
      verified: t.is_verified !== false,
      ...(dec !== null && Number.isInteger(dec) ? { decimals: dec } : {}),
    });
  }
  return out;
}

/** ตัวกรองตาราง/หน้าโทเคน: q จับ symbol/name (มีคำนี้) หรือ token address (ขึ้นต้นด้วย) ไม่สนตัวพิมพ์; chain '' = ทุกเชน */
export function matchBalance(r: BalanceRow, q: string, chain = ''): boolean {
  if (chain && r.chain !== chain) return false;
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return r.symbol.toLowerCase().includes(s) || r.name.toLowerCase().includes(s) || r.tokenId.toLowerCase().startsWith(s);
}

/** pnl-positions: { tokenPositions[] } หรือห่อด้วยที่อยู่ { "<address>": { tokenPositions[] } } — ยอด 0 ทิ้ง, ราคา = มูลค่า ÷ จำนวน */
export function parsePositions(j: unknown): BalanceRow[] {
  const wrap = isObj(j) ? (Array.isArray(j.tokenPositions) ? j : Object.values(j).find((v) => isObj(v) && Array.isArray(v.tokenPositions))) : undefined;
  const out: BalanceRow[] = [];
  for (const p of isObj(wrap) ? (wrap.tokenPositions as unknown[]) : []) {
    if (!isObj(p)) continue;
    const amount = num(p.balance);
    const id = str(p.assetId);
    if (!amount || !id) continue;
    const usd = num(p.balanceValue);
    const short = id.length > 10 ? `${id.slice(0, 6)}…` : id;
    out.push({ chain: 'sol', tokenId: id, symbol: short, name: short, logo: null, amount, price: usd !== null ? usd / amount : null, usd, verified: true, exact: decText(p.balance) });
  }
  return out;
}

async function fetchSolBalances(ep: Endpoint, origin: string, address: string, headers: Record<string, string>, onPartial?: (b: Balances) => void): Promise<Balances> {
  const res = await limitedFetch(requestUrl(`${origin}/v1/pnl-positions?address=${encodeURIComponent(address)}&filter=recentlyActive`), { headers });
  if (res.status === 429) return { rows: [], limited: true, at: Date.now() };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  let rows = byUsd(parsePositions(parseJsonExact(await res.text())));
  /* ตารางขึ้นทันที (ชื่อเป็น mint ย่อชั่วคราว) แล้วค่อยเติมชื่อ/โลโก้เมื่อ metadata มา — ไม่ให้ทั้งตารางรอ */
  onPartial?.({ rows, limited: false, at: Date.now() });
  const meta = await ensureTokenMeta(ep, rows.map((r) => r.tokenId));
  rows = rows.map((r) => {
    const m = meta.get(r.tokenId);
    return m ? { ...r, symbol: m.symbol ?? r.symbol, name: m.name ?? m.symbol ?? r.name, logo: m.logo ?? null } : r;
  });
  return { rows, limited: false, at: Date.now() };
}

const byUsd = (rows: BalanceRow[]) => [...rows].sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1));
/** ยิง token_list พร้อมกันได้เท่าขีดของคิว limitedFetch */
const PARALLEL = 2;

/** onPartial = ผลระหว่างทาง (เชนไหนเสร็จก็ขึ้นตารางก่อน) */
export async function fetchBalances(ep: Endpoint, origin: string, address: string, onPartial?: (b: Balances) => void): Promise<Balances> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (ep.authHeader && ep.apiKey) headers[ep.authHeader] = ep.apiKey;
  if (ep.family === 'sol') return fetchSolBalances(ep, origin, address, headers, onPartial);
  const get = async (url: string) => limitedFetch(requestUrl(url), { headers });
  const id = encodeURIComponent(address);
  const res = await get(`${balancePath(origin, 'chains')}?id=${id}`);
  if (res.status === 429) return { rows: [], limited: true, at: Date.now() };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const chains = parseChainIds(await res.json());
  const rows: BalanceRow[] = [];
  let limited = false;
  let next = 0;
  /* เดิมรอทีละเชน — ตอนนี้ PARALLEL งานดึงเชนถัดไปจากคิวร่วม; เจอ 429 ทุกงานหยุดหยิบเชนใหม่ */
  const worker = async () => {
    while (!limited && next < chains.length) {
      const c = chains[next++]!;
      const r = await get(`${balancePath(origin, 'tokens')}?id=${id}&is_all=true&chain_id=${encodeURIComponent(c)}`);
      if (r.status === 429) {
        limited = true;
        return;
      }
      if (!r.ok) continue;
      rows.push(...parseTokenList(parseJsonExact(await r.text()), c));
      onPartial?.({ rows: byUsd(rows), limited: false, at: Date.now() });
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, chains.length) }, worker));
  return { rows: byUsd(rows), limited, at: Date.now() };
}

/* ---------- รีเฟรชผ่าน RPC (ผู้ใช้ 2026-10-03) ---------- */

/** รายชื่อโทเคนจากแหล่งเดิมครั้งล่าสุดต่อกระเป๋า — 24 ชม.; หมดอายุแล้วค่อยถามแหล่งเดิมใหม่ (เผื่อมีโทเคนใหม่) */
const LS_ROSTER = 'xcap.scan.balroster';
const ROSTER_TTL = 24 * 3600_000;
export const roster = {
  get(k: string): Balances | null {
    try {
      const hit = (JSON.parse(localStorage.getItem(LS_ROSTER) ?? '{}') as Record<string, Balances>)[k];
      return hit && Date.now() - hit.at < ROSTER_TTL ? hit : null;
    } catch {
      return null;
    }
  },
  set(k: string, b: Balances): void {
    if (b.limited) return;
    try {
      const all = JSON.parse(localStorage.getItem(LS_ROSTER) ?? '{}') as Record<string, Balances>;
      const now = Date.now();
      for (const key of Object.keys(all)) if (now - all[key]!.at >= ROSTER_TTL) delete all[key];
      all[k] = b;
      localStorage.setItem(LS_ROSTER, JSON.stringify(all));
    } catch {
      /* เต็ม/ถูกบล็อก */
    }
  },
};

const isEvmToken = (id: string) => /^0x[0-9a-f]{40}$/i.test(id);

/**
 * จำนวนใหม่ของทุกแถวใน roster ผ่าน RPC — ราคาใช้ของเดิม (ภายใน 24 ชม.)
 * เชนที่ไม่มี RPC / ไม่รู้ chain id / แถวไม่มี decimals / RPC ล้มทุกตัว → อยู่ใน missing ให้ผู้เรียกถามแหล่งเดิมเฉพาะเชนนั้น
 */
export async function refreshViaRpc(rows: BalanceRow[], address: string, chains: ChainMap, rpcs: RpcMap, onPartial?: (rows: BalanceRow[]) => void): Promise<{ rows: BalanceRow[]; missing: string[] }> {
  const byChain = new Map<string, BalanceRow[]>();
  for (const r of rows) byChain.set(r.chain, [...(byChain.get(r.chain) ?? []), r]);
  const out: BalanceRow[] = [];
  const missing: string[] = [];
  await Promise.all(
    [...byChain].map(async ([chain, list]) => {
      const id = chainOf(chains, chain)?.evmId;
      const urls = id ? rpcs.get(id) : undefined;
      if (!urls || list.some((r) => r.decimals === undefined)) return void missing.push(chain);
      const raws = await chainBalances(urls, list.map((r) => (isEvmToken(r.tokenId) ? balanceOfCall(r.tokenId, address) : nativeCall(address))));
      if (!raws) return void missing.push(chain);
      list.forEach((r, i) => {
        const exact = raws[i] !== null ? fromRaw(raws[i]!, r.decimals!) : null;
        if (exact === null) return void out.push(r); // call เดียวล้ม → คงค่าเดิม
        const amount = Number(exact);
        if (!amount) return; // ขายหมดแล้ว
        out.push({ ...r, exact, amount, usd: r.price !== null ? amount * r.price : null });
      });
      onPartial?.(byUsd(out));
    })
  );
  return { rows: byUsd(out), missing };
}

/** token_list ของเชนที่ RPC ช่วยไม่ได้ — 429 หยุดทันที */
async function fetchChainsFromSource(ep: Endpoint, origin: string, address: string, chainIds: string[]): Promise<{ rows: BalanceRow[]; limited: boolean }> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (ep.authHeader && ep.apiKey) headers[ep.authHeader] = ep.apiKey;
  const rows: BalanceRow[] = [];
  for (const c of chainIds) {
    const r = await limitedFetch(requestUrl(`${balancePath(origin, 'tokens')}?id=${encodeURIComponent(address)}&is_all=true&chain_id=${encodeURIComponent(c)}`), { headers });
    if (r.status === 429) return { rows, limited: true };
    if (r.ok) rows.push(...parseTokenList(parseJsonExact(await r.text()), c));
  }
  return { rows, limited: false };
}

/**
 * ยอดของกระเป๋า: มี roster (ภายใน 24 ชม.) + รายการ RPC → ถาม RPC ก่อน เชนที่เหลือถามแหล่งเดิม
 * ไม่มี roster / Solana / ไม่ได้ตั้ง RPC → แหล่งเดิมทั้งหมด แล้วจด roster
 */
export async function loadBalances(ep: Endpoint, origin: string, wallet: Pick<Wallet, 'address' | 'family'>, key: string, chains: ChainMap, onPartial?: (b: Balances) => void): Promise<Balances> {
  const base = wallet.family === 'erc20' ? roster.get(key) : null;
  const rpcs = base ? await rpcList() : null;
  if (base && rpcs) {
    const got = await refreshViaRpc(base.rows, wallet.address, chains, rpcs, (rows) => onPartial?.({ rows, limited: false, at: Date.now() }));
    if (!got.missing.length) return { rows: got.rows, limited: false, at: Date.now() };
    const src = await fetchChainsFromSource(ep, origin, wallet.address, got.missing);
    return { rows: byUsd([...got.rows, ...src.rows]), limited: src.limited, at: Date.now() };
  }
  const b = await fetchBalances(ep, origin, wallet.address, onPartial);
  if (wallet.family === 'erc20') roster.set(key, b);
  return b;
}

/**
 * ราคาจากยอดคงเหลือ = ราคาปัจจุบัน → ส่งเข้าแคชราคา (เวลา = ตอนนี้) ให้แผงรายละเอียดใช้ราคาล่าสุดจริง
 * เหรียญหลักของเชน (id ไม่ใช่ที่อยู่ เช่น eth/op หรือ SOL บน Solana) เก็บซ้ำแบบไม่มี tokenId ให้ตรงคีย์ที่ priceOf ค้นด้วยสัญลักษณ์
 */
export function rememberBalancePrices(rows: BalanceRow[]): void {
  for (const r of rows) {
    if (r.price === null) continue;
    rememberPrice(r.chain, r.tokenId, r.symbol, r.price);
    const native = !(r.tokenId.startsWith('0x') || r.tokenId.length > 20) || (r.chain === 'sol' && r.symbol.toUpperCase() === 'SOL');
    if (native) rememberPrice(r.chain, null, r.symbol, r.price);
  }
}

/* แคชยอด: หน่วยความจำ + localStorage 10 นาที (ผู้ใช้ 2026-10-03 — เปิดซ้ำ/รีเฟรชไม่ยิงใหม่ ลดโอกาสเกินโควตา); Reload balance ยิงใหม่เสมอ */
const LS_BAL = 'xcap.scan.balances';
const BAL_TTL = 10 * 60_000;
const cache = {
  mem: new Map<string, Balances>(),
  get(k: string): Balances | undefined {
    const m = this.mem.get(k);
    if (m) return m;
    try {
      const all = JSON.parse(localStorage.getItem(LS_BAL) ?? '{}') as Record<string, Balances>;
      const hit = all[k];
      if (hit && Date.now() - hit.at < BAL_TTL && !hit.limited) {
        this.mem.set(k, hit);
        return hit;
      }
    } catch {
      /* ไม่มี storage */
    }
    return undefined;
  },
  has(k: string): boolean {
    return this.get(k) !== undefined;
  },
  set(k: string, b: Balances): void {
    this.mem.set(k, b);
    if (b.limited) return;
    try {
      const all = JSON.parse(localStorage.getItem(LS_BAL) ?? '{}') as Record<string, Balances>;
      const now = Date.now();
      for (const key of Object.keys(all)) if (now - all[key]!.at >= BAL_TTL) delete all[key];
      all[k] = b;
      localStorage.setItem(LS_BAL, JSON.stringify(all));
    } catch {
      /* เต็ม/ถูกบล็อก — ใช้หน่วยความจำอย่างเดียว */
    }
  },
};

export interface BalanceState {
  supported: boolean;
  data: Balances | null;
  loading: boolean;
  error: boolean;
  reload: () => void;
}

/** โหลดยอดเมื่อ active เป็นจริงครั้งแรกต่อกระเป๋า (แท็บ Tokens เปิดอยู่); reload = ยิงใหม่ */
export function useBalances(wallet: Wallet, endpoints: Endpoint[], active: boolean, chains: ChainMap = new Map()): BalanceState {
  const src = balanceSource(endpoints, wallet);
  const key = src ? `${src.origin}|${(wallet.family === 'sol' ? wallet.address : wallet.address.toLowerCase())}` : '';
  const [data, setData] = useState<Balances | null>(() => cache.get(key) ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [nonce, setNonce] = useState(0);
  /* รายชื่อเชนโหลดแบบ async — ถ้าจะใช้ RPC ต้องรู้ chain id ก่อน; รอได้ไม่เกิน 1.5 วิ แล้วค่อยไปแหล่งเดิม */
  const [waited, setWaited] = useState(false);
  const needChains = chains.size === 0 && wallet.family === 'erc20' && configuredRpcListUrl() !== '' && roster.get(key) !== null;
  useEffect(() => {
    if (!needChains) return;
    const t = setTimeout(() => setWaited(true), 1500);
    return () => clearTimeout(t);
  }, [needChains]);
  useEffect(() => setData(cache.get(key) ?? null), [key]);
  useEffect(() => {
    if (!src || !active) return;
    if (nonce === 0 && cache.has(key)) return;
    if (needChains && !waited) return;
    let live = true;
    setLoading(true);
    setError(false);
    loadBalances(src.ep, src.origin, wallet, key, chains, (b) => live && setData(b))
      .then((b) => {
        cache.set(key, b);
        rememberBalancePrices(b.rows);
        if (live) setData(b);
      })
      .catch(() => live && setError(true))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, active, nonce, needChains && !waited]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { supported: src !== null, data, loading, error, reload };
}

/** token id เป็นที่อยู่จริง (EVM 0x… หรือ mint ของ Solana) ไม่ใช่รหัสเหรียญหลัก เช่น eth/op */
export const isTokenAddress = (id: string): boolean => /^0x[0-9a-f]{40}$/i.test(id) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(id);

/**
 * ลิงก์ explorer ไปที่กระเป๋าของลูกค้า กรองเฉพาะโทเคนนั้น (ผู้ใช้ 2026-10-02) — host มาจาก chain list เท่านั้น
 *   EVM: <explorer>/token/<token>?a=<wallet>   · เหรียญหลัก: <explorer>/address/<wallet>
 *   Solana: <explorer>/account/<wallet>?exclude_amount_zero=true&page_size=100&remove_spam=true&token_address=<mint>#balanceChanges (ผู้ใช้ 2026-10-02)
 */
export function walletTokenUrl(explorer: string | null | undefined, family: 'erc20' | 'sol', wallet: string, tokenId: string): string | null {
  const host = explorer?.replace(/\/+$/, '');
  if (!host) return null;
  const w = encodeURIComponent(wallet);
  if (!isTokenAddress(tokenId)) return family === 'sol' ? `${host}/account/${w}` : `${host}/address/${w}`;
  const tk = encodeURIComponent(tokenId);
  return family === 'sol' ? `${host}/account/${w}?exclude_amount_zero=true&page_size=100&remove_spam=true&token_address=${tk}#balanceChanges` : `${host}/token/${tk}?a=${w}`;
}
