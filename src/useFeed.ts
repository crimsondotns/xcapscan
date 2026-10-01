/**
 * สถานะการโหลดต่อกระเป๋า — แต่ละกระเป๋าถูกยิงไปทุกแหล่งข้อมูลที่เปิดอยู่และตรงตระกูลเชน
 * แถวจากหลายแหล่งรวมกันแล้วตัดซ้ำด้วย key; cursor/error เก็บแยกต่อแหล่ง
 * อยู่ในหน่วยความจำเท่านั้น (รีเฟรชแล้วโหลดใหม่) ไม่มีการจดธุรกรรมลงเครื่อง
 * โหลดแบบขี้เกียจ: ไม่ยิงตอนเปิดหน้า ยิงเฉพาะเมื่อผู้ใช้เลือกกระเป๋า และกระเป๋าที่โหลดแล้วใช้แคชในหน่วยความจำ
 * เพิ่มแคชหน้าคำตอบ 5 นาที — คลิกกระเป๋าเดิม/หน้าก่อนหน้าซ้ำไม่ยิงใหม่ (ประหยัดโควตา public API)
 */
import { useCallback, useRef, useState } from 'react';

export interface Progress {
  done: number;
  total: number;
  running: boolean;
  stopped: 'rate' | 'cancel' | null;
  /** โดนจำกัดคำขอ → อีกกี่วินาทีถึงลองใหม่ได้ (ตามที่คิวคำขอกำลังพักอยู่) */
  retryIn: number;
}

/* โหลดทีละ 3 กระเป๋าต่อชุด เว้น 3 วิระหว่างชุด — คิวคำขอ (limiter) เป็นคนคุมความถี่จริง
   ตรงนี้แค่ไม่ปล่อยงานเข้าคิวทีเดียวเป็นร้อย เพื่อให้กดยกเลิกแล้วหยุดได้จริง */
const BATCH = 1;
const BATCH_GAP_MS = 5000;
/* แคชหน้าคำตอบในหน่วยความจำ — เปิดกระเป๋าเดิม/หน้าเดิมซ้ำใน 5 นาทีไม่ยิงใหม่ */
const PAGE_CACHE_TTL_MS = 5 * 60_000;
const PAGE_CACHE_MAX = 200;
import { FeedError, applyTokenMeta, fetchPage, unknownTokens, type Cursor, type Page, type TokenMeta, type TxRow } from './feed';
import { ensureTokenMeta } from './tokens';
import { pausedFor, backoff } from './limiter';
import type { Endpoint, Settings, Wallet } from './store';

export interface WalletFeed {
  rows: TxRow[];
  /** cursor ต่อแหล่งข้อมูล; undefined = ยังไม่โหลด, null = หมดแล้ว */
  next: Record<string, Cursor | null | undefined>;
  errors: Record<string, FeedError>;
  loading: boolean;
  loaded: boolean;
}

const EMPTY: WalletFeed = { rows: [], next: {}, errors: {}, loading: false, loaded: false };

/* แคชหน้าคำตอบ — คีย์คือ (URL + ที่อยู่ + cursor) ต่อแหล่ง ค่าคือ Page ที่ normalize แล้ว */
const pageCache = new Map<string, { page: Page; exp: number }>();

function pageCacheGet(key: string): Page | null {
  const hit = pageCache.get(key);
  if (!hit) return null;
  if (hit.exp <= Date.now()) {
    pageCache.delete(key);
    return null;
  }
  return hit.page;
}

function pageCacheSet(key: string, page: Page): void {
  if (pageCache.size >= PAGE_CACHE_MAX) {
    const first = pageCache.keys().next().value;
    if (first !== undefined) pageCache.delete(first);
  }
  pageCache.set(key, { page, exp: Date.now() + PAGE_CACHE_TTL_MS });
}

/** ตัวเลือกตอนโหลดหน้าที่เก่ากว่า (ใช้โดยตัวกรองวันที่ที่ดึงย้อนหลังเอง) */
export interface OlderOpts {
  /** จำนวนแถวต่อหน้า (แทน settings.pageSize) — แหล่ง sol รับหน้าใหญ่ได้ ลดจำนวนคำขอ */
  count?: number;
  /** กระโดดไปที่เวลานี้ (วินาที) เลย สำหรับแหล่งที่เลื่อนหน้าด้วย {start} — ข้ามหน้าที่ใหม่กว่าช่วงที่กรองทั้งหมด */
  seek?: number;
  /** ขอ metadata โทเคนด้วยไหม (ค่าเริ่ม true) — ปิดตอนไล่หน้าย้อนหลังเพื่อไม่ให้คำขอเพิ่มเป็นสองเท่า */
  meta?: boolean;
}
/** แหล่งนี้เลื่อนหน้าด้วยเวลา ({start}) ไหม — erc20 ที่ไม่มี placeholder แอปประกอบ start_time={start} ให้ */
export const seeksByTime = (ep: Endpoint) => ep.url.includes('{start}') || (ep.family === 'erc20' && !ep.url.includes('{'));
/** จำนวนแถวต่อหน้าที่ใช้ตอนไล่ย้อนหลัง ต่อตระกูล — erc20 (history_list) จำกัด 20 */
export const bulkCount = (family: Endpoint['family'], pageSize: number) => (family === 'sol' ? Math.max(pageSize, 100) : pageSize);

export function endpointsFor(w: Wallet, settings: Settings): Endpoint[] {
  return settings.endpoints.filter((e) => e.enabled && e.family === w.family);
}

export function useFeed(settings: Settings) {
  const [feeds, setFeeds] = useState<Record<string, WalletFeed>>({});
  const inflight = useRef(new Set<string>());
  const latest = useRef(feeds);
  latest.current = feeds;

  /**
   * เติมชื่อ/สัญลักษณ์/โลโก้ของโทเคนที่ยังไม่รู้จักในแถวที่โหลดมาแล้ว
   * เรียกซ้ำได้: ที่อยู่ที่เคยขอสำเร็จอยู่ในแคช จึงไม่ยิงซ้ำ ที่ยังไม่สำเร็จเท่านั้นที่ยิงใหม่
   * หมายเหตุ: ไม่ถูกเรียกอัตโนมัติแล้ว — WalletPage เรียกเมื่อผู้ใช้เปิดแท็บ Tokens
   */
  const fillMeta = useCallback(
    async (w: Wallet, tries = 3, delay = 1200): Promise<void> => {
      const eps = endpointsFor(w, settings).filter((e) => e.metaUrl);
      if (!eps.length) return;
      for (let i = 0; i < tries; i++) {
        const ids = unknownTokens(latest.current[w.id]?.rows ?? []);
        if (!ids.length) return;
        const meta = new Map<string, TokenMeta>();
        for (const ep of eps) for (const [k, v] of await ensureTokenMeta(ep, ids)) meta.set(k, v);
        if (meta.size) {
          setFeeds((s) => {
            const f = s[w.id];
            if (!f) return s;
            const rows = applyTokenMeta(f.rows, meta);
            return rows === f.rows ? s : { ...s, [w.id]: { ...f, rows } };
          });
          return;
        }
        await new Promise((r) => setTimeout(r, delay * (i + 1)));
      }
    },
    [settings]
  );

  const load = useCallback(
    async (w: Wallet, mode: 'reset' | 'older', opts: OlderOpts = {}) => {
      const eps = endpointsFor(w, settings);
      if (!eps.length || inflight.current.has(w.id)) return;
      inflight.current.add(w.id);
      const cur = latest.current[w.id] ?? EMPTY;
      setFeeds((s) => ({ ...s, [w.id]: { ...(s[w.id] ?? EMPTY), loading: true, errors: {} } }));

      const results = await Promise.all(
        eps.map(async (ep) => {
          const prevCur = mode === 'older' ? cur.next[ep.id] : null;
          // กระโดดตามเวลา: ใช้เฉพาะเมื่อ seek เก่ากว่าตำแหน่งปัจจุบัน (ไม่ย้อนกลับไปหน้าที่ใหม่กว่า)
          const c: Cursor | null | undefined =
            opts.seek !== undefined && prevCur !== null && seeksByTime(ep) && (!prevCur || prevCur.start > opts.seek) ? { start: opts.seek, cursor: '', offset: prevCur?.offset ?? 0 } : prevCur;
          if (mode === 'older' && c === null) return { ep, page: null, error: null, count: 0 };
          const count = opts.count ?? settings.pageSize;

          // ตรวจแคชก่อนยิงจริง — เปิดกระเป๋าเดิม/หน้าเดิมซ้ำใน 5 นาทีใช้ของเดิม
          const ck = `${ep.url}|${w.address.toLowerCase()}|${c?.next ?? c?.start ?? 'first'}|${count}`;
          const cached = pageCacheGet(ck);
          if (cached) return { ep, page: cached, error: null, count };

          try {
            const page = await fetchPage(ep.url, w.id, w.address, c ?? null, count, { family: ep.family, authHeader: ep.authHeader, apiKey: ep.apiKey });
            // แหล่งที่ตั้ง URL metadata ไว้ → เติมชื่อ/สัญลักษณ์/โลโก้ของโทเคนที่ยังไม่รู้ก่อนแสดง
            const ids = ep.metaUrl && opts.meta !== false ? unknownTokens(page.rows) : [];
            const finalPage = (ids.length ? { ...page, rows: applyTokenMeta(page.rows, await ensureTokenMeta(ep, ids)) } : page) as Page;
            pageCacheSet(ck, finalPage);
            return { ep, page: finalPage, error: null, count };
          } catch (e) {
            return { ep, page: null, error: e instanceof FeedError ? e : new FeedError('net'), count };
          }
        })
      );

      // แหล่งไหนตอบ 429 → พักทั้งคิวคำขอ (limiter) ทันที ไม่ให้ใครยิงต่อจนครบเวลา — UI อ่านเวลาที่เหลือจาก pausedFor()
      if (results.some((r) => r.error?.kind === 'http' && r.error.status === 429) && pausedFor() === 0) backoff(null);

      setFeeds((s) => {
        const prev = s[w.id] ?? EMPTY;
        const rows = mode === 'older' ? [...prev.rows] : [];
        const seen = new Set(rows.map((r) => r.key));
        const next: WalletFeed['next'] = mode === 'older' ? { ...prev.next } : {};
        const errors: WalletFeed['errors'] = {};
        for (const r of results) {
          if (r.error) {
            errors[r.ep.id] = r.error;
            continue;
          }
          if (!r.page) continue;
          let grew = false;
          for (const row of r.page.rows) {
            if (seen.has(row.key)) continue;
            seen.add(row.key);
            rows.push(row);
            grew = true;
          }
          // offset สะสมข้ามหน้า (หน้า 2 = offset ของหน้า 1 + จำนวนที่ได้) — start/cursor ใช้ของหน้าล่าสุด
          const before = mode === 'older' ? prev.next[r.ep.id] : null;
          next[r.ep.id] = grew && r.page.rows.length >= (r.count || settings.pageSize) && r.page.next ? { ...r.page.next, offset: (before?.offset ?? 0) + r.page.next.offset } : (grew && r.page.next?.next ? r.page.next : null);
        }
        return { ...s, [w.id]: { rows, next, errors, loading: false, loaded: true } };
      });
      inflight.current.delete(w.id);
      // หมายเหตุ: ไม่เรียก fillMeta อัตโนมัติ — WalletPage เรียกเมื่อผู้ใช้เปิดแท็บ Tokens
    },
    [settings, fillMeta]
  );

  const loadMany = useCallback(
    (ws: Wallet[], mode: 'reset' | 'older', opts?: OlderOpts) => {
      // ยิงทีละ 4 กระเป๋า ไม่ให้แหล่งข้อมูลโดนรุมตอนนำเข้ากระเป๋าเป็นร้อย
      let i = 0;
      const worker = async () => {
        while (i < ws.length) {
          const w = ws[i++];
          if (w) await load(w, mode, opts);
        }
      };
      return Promise.all(Array.from({ length: Math.min(4, ws.length) }, worker));
    },
    [load]
  );

  /* โหลดแบบเว้นจังหวะ: ทีละ 3 กระเป๋าพร้อมกัน เว้น 3 วิ แล้วชุดถัดไป — เหมือนคนกดทีละอัน กัน rate limit
     หยุดเองเมื่อเจอ 429 และผู้ใช้ยกเลิกได้ */
  const [progress, setProgress] = useState<Progress>({ done: 0, total: 0, running: false, stopped: null, retryIn: 0 });
  const cancelRef = useRef(false);
  const loadStaggered = useCallback(
    async (ws: Wallet[]) => {
      const todo = ws.filter((w) => !latest.current[w.id]?.loaded && endpointsFor(w, settings).length);
      if (!todo.length) return;
      cancelRef.current = false;
      setProgress({ done: 0, total: todo.length, running: true, stopped: null, retryIn: 0 });
      for (let i = 0; i < todo.length; i += BATCH) {
        if (cancelRef.current) {
          setProgress((p) => ({ ...p, running: false, stopped: 'cancel' }));
          return;
        }
        // คิวถูกพักอยู่ (จากที่อื่นในเบราว์เซอร์นี้ prolong ไว้) → อัปเดตตัวเลขแล้วหยุดรอ
        const wait0 = pausedFor();
        if (wait0 > 0) {
          setProgress((p) => ({ ...p, running: false, stopped: 'rate', retryIn: Math.ceil(wait0 / 1000) }));
          return;
        }
        const batch = todo.slice(i, i + BATCH);
        await Promise.all(batch.map((w) => load(w, 'reset')));
        setProgress((p) => ({ ...p, done: Math.min(todo.length, i + batch.length) }));
        const limited = batch.some((w) => Object.values(latest.current[w.id]?.errors ?? {}).some((e) => e.kind === 'http' && e.status === 429));
        if (limited) {
          const ms = backoff(null); // ตั้ง pause + บีบท่อ + บันทึก localStorage
          setProgress((p) => ({ ...p, running: false, stopped: 'rate', retryIn: Math.ceil(ms / 1000) }));
          return;
        }
        if (i + BATCH < todo.length) {
          // คิวถูกพักอยู่ (เพิ่งเจอ 429 ระหว่างทาง) → รอให้ครบก่อนค่อยส่งชุดถัดไป
          await new Promise((r) => setTimeout(r, Math.max(BATCH_GAP_MS, pausedFor())));
        }
      }
      setProgress((p) => ({ ...p, running: false }));
    },
    [load, settings]
  );
  const cancelStaggered = useCallback(() => {
    cancelRef.current = true;
  }, []);

  /** โหลดถ้ายังไม่มีในแคช (เคยโหลดสำเร็จหรือกำลังโหลด → ไม่ยิงซ้ำ) */
  const ensure = useCallback(
    (w: Wallet) => {
      const f = latest.current[w.id];
      if (f?.loaded || f?.loading) return Promise.resolve();
      return load(w, 'reset');
    },
    [load]
  );

  /** ล้างแคชทั้งหมด (แหล่งข้อมูลเปลี่ยน) — ไม่โหลดใหม่เอง รอผู้ใช้เลือกกระเป๋า */
  const reset = useCallback(() => {
    setFeeds({});
    pageCache.clear();
  }, []);

  const forget = useCallback((id: string) => {
    setFeeds((s) => {
      const { [id]: _drop, ...rest } = s;
      return rest;
    });
  }, []);

  return { feeds, load, loadMany, loadStaggered, cancelStaggered, progress, ensure, reset, forget, fillMeta };
}

export function hasOlder(f: WalletFeed | undefined): boolean {
  return !!f?.loaded && Object.values(f.next).some((c) => c !== null && c !== undefined);
}