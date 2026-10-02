/**
 * ยอดคงเหลือของกระเป๋า (ผู้ใช้ 2026-10-02) — ไม่มี host ใดฝังในโค้ด: ใช้ origin ของแหล่ง ERC-20 ที่ผู้ใช้วางเอง
 * (เหมือน chains.ts ที่ใช้ <origin>/v1/chain/list)
 *   1) <origin>/v1/user/used_chain_list?id={address}            → เชนที่กระเป๋านี้ใช้
 *   2) <origin>/v1/user/token_list?id={address}&is_all=true&chain_id={chain}  ต่อเชน → โทเคน + amount + price
 * กระเป๋า Solana (ผู้ใช้ 2026-10-02): origin ของแหล่ง Solana ตัวแรก → <origin>/v1/pnl-positions?address={address}&filter=recentlyActive
 *   → tokenPositions[] (balance, balanceValue) ชื่อ/สัญลักษณ์/โลโก้เติมจาก metaUrl ของแหล่ง (tokens.ts)
 * ทุกคำขอผ่าน limitedFetch; เจอ 429 หยุดทันที คืนเท่าที่ได้ (limited) — limiter พักคิวให้แล้ว
 * แคชในหน่วยความจำต่อกระเป๋า (ยอดเปลี่ยนบ่อย ไม่เขียน localStorage)
 */
import { useCallback, useEffect, useState } from 'react';
import { limitedFetch } from './limiter';
import { requestUrl } from './proxy';
import { ensureTokenMeta } from './tokens';
import { rememberPrice } from './prices';
import type { Endpoint, Wallet } from './store';

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
}

export interface Balances {
  rows: BalanceRow[];
  /** เจอ 429 ระหว่างทาง — ได้ไม่ครบทุกเชน */
  limited: boolean;
  at: number;
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
    out.push({
      chain: str(t.chain) ?? chain,
      tokenId: str(t.id) ?? symbol,
      symbol,
      name: str(t.name) ?? symbol,
      logo: str(t.logo_url),
      amount,
      price,
      usd: price !== null ? amount * price : null,
      verified: t.is_verified !== false,
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
    out.push({ chain: 'sol', tokenId: id, symbol: short, name: short, logo: null, amount, price: usd !== null ? usd / amount : null, usd, verified: true });
  }
  return out;
}

async function fetchSolBalances(ep: Endpoint, origin: string, address: string, headers: Record<string, string>): Promise<Balances> {
  const res = await limitedFetch(requestUrl(`${origin}/v1/pnl-positions?address=${encodeURIComponent(address)}&filter=recentlyActive`), { headers });
  if (res.status === 429) return { rows: [], limited: true, at: Date.now() };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  let rows = parsePositions(await res.json());
  const meta = await ensureTokenMeta(ep, rows.map((r) => r.tokenId));
  rows = rows.map((r) => {
    const m = meta.get(r.tokenId);
    return m ? { ...r, symbol: m.symbol ?? r.symbol, name: m.name ?? m.symbol ?? r.name, logo: m.logo ?? null } : r;
  });
  rows.sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1));
  return { rows, limited: false, at: Date.now() };
}

export async function fetchBalances(ep: Endpoint, origin: string, address: string): Promise<Balances> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (ep.authHeader && ep.apiKey) headers[ep.authHeader] = ep.apiKey;
  if (ep.family === 'sol') return fetchSolBalances(ep, origin, address, headers);
  const get = async (url: string) => limitedFetch(requestUrl(url), { headers });
  const id = encodeURIComponent(address);
  const res = await get(`${balancePath(origin, 'chains')}?id=${id}`);
  if (res.status === 429) return { rows: [], limited: true, at: Date.now() };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const chains = parseChainIds(await res.json());
  const rows: BalanceRow[] = [];
  let limited = false;
  for (const c of chains) {
    const r = await get(`${balancePath(origin, 'tokens')}?id=${id}&is_all=true&chain_id=${encodeURIComponent(c)}`);
    if (r.status === 429) {
      limited = true;
      break;
    }
    if (!r.ok) continue;
    rows.push(...parseTokenList(await r.json(), c));
  }
  rows.sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1));
  return { rows, limited, at: Date.now() };
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

const cache = new Map<string, Balances>();

export interface BalanceState {
  supported: boolean;
  data: Balances | null;
  loading: boolean;
  error: boolean;
  reload: () => void;
}

/** โหลดยอดเมื่อ active เป็นจริงครั้งแรกต่อกระเป๋า (แท็บ Tokens เปิดอยู่); reload = ยิงใหม่ */
export function useBalances(wallet: Wallet, endpoints: Endpoint[], active: boolean): BalanceState {
  const src = balanceSource(endpoints, wallet);
  const key = src ? `${src.origin}|${(wallet.family === 'sol' ? wallet.address : wallet.address.toLowerCase())}` : '';
  const [data, setData] = useState<Balances | null>(() => cache.get(key) ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [nonce, setNonce] = useState(0);
  useEffect(() => setData(cache.get(key) ?? null), [key]);
  useEffect(() => {
    if (!src || !active) return;
    if (nonce === 0 && cache.has(key)) return;
    let live = true;
    setLoading(true);
    setError(false);
    fetchBalances(src.ep, src.origin, wallet.address)
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
  }, [key, active, nonce]);
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
