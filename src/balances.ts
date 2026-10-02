/**
 * ยอดคงเหลือของกระเป๋า (ผู้ใช้ 2026-10-02) — ไม่มี host ใดฝังในโค้ด: ใช้ origin ของแหล่ง ERC-20 ที่ผู้ใช้วางเอง
 * (เหมือน chains.ts ที่ใช้ <origin>/v1/chain/list)
 *   1) <origin>/v1/user/used_chain_list?id={address}            → เชนที่กระเป๋านี้ใช้
 *   2) <origin>/v1/user/token_list?id={address}&is_all=true&chain_id={chain}  ต่อเชน → โทเคน + amount + price
 * ทุกคำขอผ่าน limitedFetch; เจอ 429 หยุดทันที คืนเท่าที่ได้ (limited) — limiter พักคิวให้แล้ว
 * แคชในหน่วยความจำต่อกระเป๋า (ยอดเปลี่ยนบ่อย ไม่เขียน localStorage)
 */
import { useCallback, useEffect, useState } from 'react';
import { limitedFetch } from './limiter';
import { requestUrl, viaWrapper } from './proxy';
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

/** แหล่ง ERC-20 ตัวแรกที่เปิดอยู่ (ตามลำดับความสำคัญ) — กระเป๋า Solana / ไม่มีแหล่ง = null */
export function balanceSource(endpoints: Endpoint[], wallet: Pick<Wallet, 'family'>): { ep: Endpoint; origin: string } | null {
  if (wallet.family !== 'erc20') return null;
  for (const ep of endpoints) {
    if (!ep.enabled || ep.family !== 'erc20') continue;
    try {
      return { ep, origin: new URL(ep.url).origin };
    } catch {
      /* แม่แบบผ่าน wrapper / URL เพี้ยน → ข้าม */
    }
  }
  return null;
}

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

export async function fetchBalances(ep: Endpoint, origin: string, address: string): Promise<Balances> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (!viaWrapper(ep.url) && ep.authHeader && ep.apiKey) headers[ep.authHeader] = ep.apiKey;
  const get = async (path: string) => limitedFetch(requestUrl(`${origin}${path}`), { headers });
  const id = encodeURIComponent(address);
  const res = await get(`/v1/user/used_chain_list?id=${id}`);
  if (res.status === 429) return { rows: [], limited: true, at: Date.now() };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const chains = parseChainIds(await res.json());
  const rows: BalanceRow[] = [];
  let limited = false;
  for (const c of chains) {
    const r = await get(`/v1/user/token_list?id=${id}&is_all=true&chain_id=${encodeURIComponent(c)}`);
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
  const key = src ? `${src.origin}|${wallet.address.toLowerCase()}` : '';
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
