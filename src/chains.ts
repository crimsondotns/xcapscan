/**
 * รายชื่อเชน (ชื่อ/โลโก้/explorer) — จาก URL ที่ผู้ใช้วางใน Settings ก่อน แล้ว fallback เป็น
 * `<origin>/v1/chain/list` ของแหล่งประวัติแต่ละแหล่ง ไม่มี host ใดฝังในโค้ด; ล้มเหลวก็แค่ใช้ตัวอักษรแทน
 * cache ใน localStorage 24 ชม. ต่อ origin
 */
import { useEffect, useState } from 'react';
import { requestUrl, usableUrl } from './proxy';
import { limitedFetch } from './limiter';
import type { Settings } from './store';

/** หา chain โดยไม่สนตัวพิมพ์ (แหล่งบางแห่งส่ง 'Sol'/'SOL') */
export function chainOf(map: ChainMap, id: string): ChainInfo | undefined {
  return map.get(id) ?? map.get(id.toLowerCase());
}

export interface ChainInfo {
  id: string;
  name: string;
  logo: string | null;
  explorer: string | null;
  symbol: string | null;
  /** chain id ตัวเลขของ EVM (เช่น 1, 56) — ใช้จับคู่กับรายการ RPC; ไม่มี = null */
  evmId?: number | null;
}

const KEY = 'xcap.scan.chains.v2';
const FAIL_KEY = 'xcap.scan.chains.fail';
const FAIL_TTL = 60 * 60 * 1000;
const TTL = 24 * 3600 * 1000;
const PATH = '/v1/chain/list';

type Dict = Record<string, unknown>;
const isObj = (v: unknown): v is Dict => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const https = (v: unknown): string | null => (typeof v === 'string' && /^https:\/\//i.test(v) ? v : null);

/** ค่าแรกที่ใช้ได้จากหลายชื่อฟิลด์ — รายชื่อเชนแต่ละเจ้าตั้งชื่อไม่เหมือนกัน */
const pick = (c: Dict, keys: string[], f: (v: unknown) => string | null): string | null => {
  for (const k of keys) {
    const v = f(c[k]);
    if (v) return v;
  }
  return null;
};

/** chain id ตัวเลข: community_id / network_id / chain_id หรือ chainId ที่เป็นตัวเลข */
function evmIdOf(c: Dict): number | null {
  for (const k of ['community_id', 'network_id', 'chain_id', 'chainId']) {
    const v = typeof c[k] === 'string' ? Number(c[k]) : c[k];
    if (typeof v === 'number' && Number.isInteger(v) && v > 0) return v;
  }
  return null;
}

/**
 * แปลงรายชื่อเชนให้เป็นรูปเดียว — รับได้ทั้งอาร์เรย์ตรงๆ และที่ห่อใน data / data.chains
 * ชื่อฟิลด์ของแต่ละเจ้าไม่ตรงกัน (บางเจ้าส่ง explorer_host บางเจ้า explorer/browser และบางเจ้าเป็นรายการ explorers[])
 * จึงลองหลายชื่อแทนที่จะยึดชื่อเดียว ไม่งั้นลิงก์ explorer จะว่างทั้งระบบโดยไม่มีอะไรฟ้อง
 */
export function normalize(body: unknown): ChainInfo[] {
  const list = Array.isArray(body) ? body : isObj(body) && Array.isArray(body.data) ? body.data : isObj(body) && isObj(body.data) && Array.isArray(body.data.chains) ? body.data.chains : isObj(body) && Array.isArray(body.chains) ? body.chains : [];
  const out: ChainInfo[] = [];
  for (const c of list) {
    if (!isObj(c)) continue;
    const id = str(c.id) ?? str(c.chain) ?? str(c.chainId) ?? str(c.short_name);
    if (!id) continue;
    // explorers: [{ url }] — รูปแบบของรายชื่อเชนสาธารณะบางเจ้า
    const fromList = Array.isArray(c.explorers) ? c.explorers.map((e) => (isObj(e) ? https(e.url) : null)).find((v) => v) : null;
    out.push({
      id,
      name: str(c.name) ?? str(c.chainName) ?? id,
      logo: pick(c, ['logo_url', 'svg_logo_url', 'logoURI', 'logo', 'icon', 'image'], https),
      explorer: pick(c, ['explorer_host', 'explorer', 'explorer_url', 'explorerUrl', 'browser', 'block_explorer', 'blockExplorer'], https) ?? fromList ?? null,
      symbol: pick(c, ['token_symbol', 'native_symbol', 'symbol', 'nativeSymbol'], str),
      evmId: evmIdOf(c),
    });
  }
  return out;
}

interface Cache {
  [origin: string]: { at: number; chains: ChainInfo[] };
}

function readCache(): Cache {
  try {
    return (JSON.parse(localStorage.getItem(KEY) ?? '{}') as Cache) ?? {};
  } catch {
    return {};
  }
}

async function fetchList(url: string): Promise<ChainInfo[]> {
  const cache = readCache();
  const hit = cache[url];
  if (hit && Date.now() - hit.at < TTL && hit.chains.length) return hit.chains;
  // เคยล้มเหลวภายใน 1 ชม. (CORS/404) → ไม่ยิงซ้ำทุกครั้งที่เปิดหน้า
  let fails: Record<string, number> = {};
  try {
    fails = (JSON.parse(localStorage.getItem(FAIL_KEY) ?? '{}') as Record<string, number>) ?? {};
  } catch {
    /* ไม่มี storage */
  }
  if (!hit?.chains.length && fails[url] && Date.now() - fails[url] < FAIL_TTL) return [];
  let chains: ChainInfo[] = [];
  try {
    const res = await limitedFetch(requestUrl(url), { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(String(res.status));
    chains = normalize(await res.json());
  } catch (e) {
    // โหลดใหม่ไม่ได้ (หมดอายุ 24 ชม. แล้วแหล่งตอบ error/CORS) → ใช้ของเก่าที่เคยได้ต่อไป ดีกว่าหายไปทั้งชื่อ/โลโก้/explorer
    if (hit?.chains.length) return hit.chains;
    try {
      localStorage.setItem(FAIL_KEY, JSON.stringify({ ...fails, [url]: Date.now() }));
    } catch {
      /* ignore */
    }
    throw e;
  }
  if (!chains.length && hit?.chains.length) return hit.chains;
  if (chains.length) {
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...cache, [url]: { at: Date.now(), chains } }));
    } catch {
      /* ignore */
    }
  }
  return chains;
}

export type ChainMap = Map<string, ChainInfo>;

/** URL ที่ผู้ใช้วางมาก่อน แล้วค่อย <origin>/v1/chain/list ของแต่ละแหล่ง */
export function useChains(settings: Settings): ChainMap {
  const [map, setMap] = useState<ChainMap>(new Map());
  const urls = [
    ...(usableUrl(settings.chainListUrl) ? [settings.chainListUrl] : []),
    ...new Set(
      settings.endpoints
        // fallback <origin>/v1/chain/list มีเฉพาะแหล่งตระกูล ERC-20 — แหล่ง Solana ไม่มี path นี้ ยิงไปก็โดน CORS/404 ในคอนโซลเปล่าๆ
        .filter((e) => e.enabled && e.family === 'erc20')
        .flatMap((e) => {
          try {
            return [new URL(e.url).origin + PATH];
          } catch {
            return [];
          }
        })
    ),
  ].join('|');

  useEffect(() => {
    let alive = true;
    if (!urls) {
      setMap(new Map());
      return;
    }
    void Promise.all(urls.split('|').map((u) => fetchList(u).catch(() => [] as ChainInfo[]))).then((lists) => {
      if (!alive) return;
      const m: ChainMap = new Map();
      for (const list of lists) for (const c of list) if (!m.has(c.id.toLowerCase())) m.set(c.id.toLowerCase(), { ...c, id: c.id.toLowerCase() });
      setMap(m);
    });
    return () => {
      alive = false;
    };
  }, [urls]);

  // เชนที่ผู้ใช้กำหนดเอง ทับ/เติมของที่ได้จาก chain list
  const overrides = JSON.stringify(settings.chains);
  const [merged, setMerged] = useState<ChainMap>(map);
  useEffect(() => {
    const m: ChainMap = new Map(map);
    for (const o of settings.chains) {
      const base = m.get(o.id);
      m.set(o.id, { id: o.id, name: o.name || base?.name || o.id, logo: https(o.logo) ?? base?.logo ?? null, explorer: https(o.explorer) ?? base?.explorer ?? null, symbol: base?.symbol ?? null, evmId: base?.evmId ?? null });
    }
    setMerged(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, overrides]);

  return merged;
}
