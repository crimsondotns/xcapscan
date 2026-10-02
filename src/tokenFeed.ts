/**
 * ประวัติของโทเคนตัวเดียวในกระเป๋าเดียว (ผู้ใช้ 2026-10-02) — ขอจากแหล่ง ERC-20 โดยตรงพร้อมตัวกรอง
 * `chain_id` + `token_id` ต่อท้ายแม่แบบประวัติเดิม แทนการไล่โหลดประวัติทั้งกระเป๋าแล้วกรองในเครื่อง
 * (ได้เฉพาะแถวของโทเคนนั้น หน้าแรกเห็นทันที) — เลื่อนหน้าด้วย cursor เดิมของ fetchPage
 * กระเป๋า Solana: <origin ของแหล่ง Solana ตัวแรก>/v1/pnl-activity?address={address}&assetId={mint}
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { FeedError, applyTokenMeta, fetchPage, toTemplate, unknownTokens, type Cursor } from './feed';
import { ensureTokenMeta } from './tokens';
import type { TxRow } from './feed';
import type { Endpoint, Wallet } from './store';

/** แม่แบบประวัติ + ตัวกรองโทเคน (แทนค่าเดิมถ้าผู้ใช้ใส่ chain_id/token_id มาเอง) */
export function tokenTemplate(url: string, chain: string, tokenId: string): string {
  let t = toTemplate(url, 'erc20');
  for (const [k, v] of [
    ['chain_id', chain],
    ['token_id', tokenId],
  ] as const) {
    const re = new RegExp(`([?&]${k}=)[^&]*`);
    t = re.test(t) ? t.replace(re, `$1${encodeURIComponent(v)}`) : `${t}${t.includes('?') ? '&' : '?'}${k}=${encodeURIComponent(v)}`;
  }
  return t;
}

/** แม่แบบประวัติโทเคนของ Solana จาก origin ของแหล่ง */
export function solTokenTemplate(url: string, mint: string): string | null {
  try {
    return `${new URL(url).origin}/v1/pnl-activity?address={address}&assetId=${encodeURIComponent(mint)}`;
  } catch {
    return null;
  }
}

export interface TokenHistory {
  supported: boolean;
  rows: TxRow[];
  loading: boolean;
  hasMore: boolean;
  limited: boolean;
  more: () => void;
}

export function useTokenHistory(wallet: Wallet | null, endpoints: Endpoint[], chain: string | null, tokenId: string | null, pageSize: number): TokenHistory {
  const family = wallet?.family;
  const ep = family ? endpoints.find((e) => e.enabled && e.family === family) : undefined;
  const tpl = !ep || !tokenId ? null : family === 'sol' ? solTokenTemplate(ep.url, tokenId) : chain ? tokenTemplate(ep.url, chain, tokenId) : null;
  const supported = !!(wallet && ep && tpl);
  const key = supported ? `${ep!.id}|${wallet!.address}|${chain}|${tokenId}` : '';
  const [rows, setRows] = useState<TxRow[]>([]);
  const [next, setNext] = useState<Cursor | null>(null);
  const [loading, setLoading] = useState(false);
  const [limited, setLimited] = useState(false);
  const [done, setDone] = useState(false);
  const busy = useRef(false);
  const live = useRef(key);

  const load = useCallback(
    async (cur: Cursor | null) => {
      if (!supported || busy.current) return;
      busy.current = true;
      setLoading(true);
      const k = key;
      try {
        const raw = await fetchPage(tpl!, wallet!.id, wallet!.address, cur, pageSize, { family: family!, authHeader: ep!.authHeader, apiKey: ep!.apiKey });
        const ids = ep!.metaUrl ? unknownTokens(raw.rows) : [];
        const page = ids.length ? { ...raw, rows: applyTokenMeta(raw.rows, await ensureTokenMeta(ep!, ids)) } : raw;
        if (live.current !== k) return;
        setRows((r) => {
          const seen = new Set(r.map((x) => x.key));
          return [...r, ...page.rows.filter((x) => !seen.has(x.key))];
        });
        setNext(page.next);
        setDone(!page.next || page.rows.length === 0);
      } catch (e) {
        if (live.current !== k) return;
        if (e instanceof FeedError && e.status === 429) setLimited(true);
        setDone(true);
      } finally {
        busy.current = false;
        if (live.current === k) setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, pageSize],
  );

  useEffect(() => {
    live.current = key;
    busy.current = false;
    setRows([]);
    setNext(null);
    setDone(false);
    setLimited(false);
    if (supported) void load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const more = useCallback(() => {
    if (!done && next) void load(next);
  }, [done, next, load]);

  return { supported, rows, loading, hasMore: supported && !done && !!next, limited, more };
}
