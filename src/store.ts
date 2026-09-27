/**
 * สถานะที่คงอยู่ทั้งหมดของแอป — localStorage ก้อนเดียว เวอร์ชันกำกับ
 * ไม่มีบัญชี ไม่มี sync: กระเป๋าและแหล่งข้อมูลอยู่บนเครื่องนี้เท่านั้น
 */
import { useCallback, useSyncExternalStore } from 'react';
import { configFingerprint, configuredChainListUrl, configuredChains, configuredEndpoints, withConfiguredChains } from './config';

export type Family = 'erc20' | 'sol';
/** ค่าที่บันทึกไว้เดิมใช้คำว่า evm — แปลงตอนอ่านเพื่อไม่ให้ข้อมูลเก่าพัง */
export const toFamily = (v: unknown): Family => (v === 'sol' ? 'sol' : 'erc20');

export interface Wallet {
  id: string;
  label: string;
  address: string;
  family: Family;
  enabled: boolean;
  /** แท็กที่ผู้ใช้ตั้งเอง ใส่ได้หลายอัน — ใช้จัดกลุ่มในแถบซ้าย (ไม่มี = ไม่อยู่กลุ่มแท็กไหน) */
  tags?: string[];
}

export interface Endpoint {
  id: string;
  name: string;
  /** แม่แบบ URL ที่ผู้ใช้ใส่เอง ต้องมี {address}; {start} {count} {cursor} เลือกใส่ได้ */
  url: string;
  family: Family;
  enabled: boolean;
  /** header ยืนยันตัวตน (เลือกใส่) — อยู่ใน localStorage เครื่องนี้เท่านั้น */
  authHeader?: string;
  apiKey?: string;
  /** URL ขอ metadata โทเคน (ชื่อ/สัญลักษณ์/โลโก้) เป็นชุด — ว่าง = ไม่ขอ */
  metaUrl?: string;
}

/** ส่วนบนสลิปที่ซ่อน/แสดงได้ (ตั้งค่า) */
export const SLIP_FIELDS = ['headline', 'assets', 'usd', 'fee', 'wallet', 'walletLabel', 'protocol', 'to', 'status', 'hash', 'qr', 'code', 'issued'] as const;
export type SlipField = (typeof SLIP_FIELDS)[number];
export type SlipShow = Record<SlipField, boolean>;
export const SLIP_SHOW_DEFAULT: SlipShow = Object.fromEntries(SLIP_FIELDS.map((f) => [f, true])) as SlipShow;

/** ข้อมูลเชนที่ผู้ใช้ใส่เอง (ทับ/เติม chain list): โลโก้ + explorer ต่อ chain id */
export interface ChainOverride {
  id: string;
  name?: string;
  logo?: string;
  explorer?: string;
}

export interface Settings {
  endpoints: Endpoint[];
  pageSize: number;
  /** URL รายชื่อเชน (ชื่อ/โลโก้/explorer) ที่ผู้ใช้วางเอง — ว่าง = ใช้ <origin>/v1/chain/list ของแต่ละแหล่ง */
  chainListUrl: string;
  /** URL ราคาโทเคนที่ผู้ใช้วางเอง — ว่าง = ใช้แค่ราคาที่มากับธุรกรรม */
  priceUrl: string;
  /** ซ่อนแถวที่ติดธงน่าสงสัย/หลอกลวง */
  hideScam: boolean;
  /** ป้ายบนสลิปที่แสดง (ค่าเริ่มต้นแสดงทั้งหมด) */
  slipShow: SlipShow;
  /** ทางผ่านคำขอของผู้ใช้เอง (CORS) — ว่าง = ยิงตรง (dev ใช้ /__proxy ของ vite) */
  proxyUrl: string;
  /** เชนที่ผู้ใช้กำหนดเอง (โลโก้/explorer) — ใช้ก่อน chain list */
  chains: ChainOverride[];
}

interface State {
  v: 2;
  wallets: Wallet[];
  settings: Settings;
  /** ลายนิ้วมือของค่าที่ฝังตอน build ตอนที่บันทึกครั้งล่าสุด (ดู applyBuildConfig) */
  cfg?: string;
}

/** ค่าที่ฝังตอน build ที่มีผลกับข้อมูลในเครื่อง */
export interface BuildConfig {
  endpoints: Endpoint[];
  chainListUrl: string;
  chains: ChainOverride[];
  fingerprint: string;
}

/**
 * รวมค่าที่ฝังตอน build เข้ากับค่าที่บันทึกไว้ในเครื่อง
 *
 * แหล่งข้อมูลและรายชื่อเชนไม่มีช่องให้แก้ในหน้าเว็บแล้ว (มาจากตอน build อย่างเดียว)
 * ค่าที่บันทึกไว้จึงเป็นแค่สำเนาของ build ครั้งก่อน — พอเปลี่ยน secret แล้ว deploy ใหม่
 * เบราว์เซอร์ที่เคยเปิดไว้ต้องรับค่าใหม่ ไม่ใช่ยึดสำเนาเก่าไว้ตลอดไป (เคยทำให้ลิงก์ explorer หายทั้งระบบ)
 * ลายนิ้วมือยังเท่าเดิม = ไม่มีอะไรเปลี่ยน ให้ของในเครื่องชนะ (เช่นที่กู้คืนมาจากไฟล์สำรอง)
 */
export function applyBuildConfig(saved: { endpoints: Endpoint[]; chainListUrl: string; chains: ChainOverride[]; cfg?: string }, cfg: BuildConfig): { endpoints: Endpoint[]; chainListUrl: string; chains: ChainOverride[] } {
  // ค่าที่ฝังตอน build เปลี่ยนไปจากตอนที่บันทึกไว้ (หรือเครื่องนี้ยังไม่เคยจำลายนิ้วมือ)
  const changed = cfg.fingerprint !== '' && saved.cfg !== cfg.fingerprint;
  const takeEndpoints = cfg.endpoints.length > 0 && (changed || saved.endpoints.length === 0);
  const takeUrl = cfg.chainListUrl !== '' && (changed || saved.chainListUrl === '');
  // เชนจาก build ชนะของเก่าที่ id ซ้ำกันเมื่อค่าเปลี่ยน; เชนที่ผู้ใช้กู้คืนมาเองและไม่ชนกัน ยังอยู่ครบ
  const keep = changed ? saved.chains.filter((c) => !cfg.chains.some((x) => x.id === c.id)) : saved.chains;
  return {
    endpoints: takeEndpoints ? cfg.endpoints : saved.endpoints,
    chainListUrl: takeUrl ? cfg.chainListUrl : saved.chainListUrl,
    chains: withConfiguredChains(keep, cfg.chains),
  };
}

const buildConfig = (): BuildConfig => ({ endpoints: configuredEndpoints(), chainListUrl: configuredChainListUrl(), chains: configuredChains(), fingerprint: configFingerprint() });

const KEY = 'xcap.scan.v1';
const DEFAULT: State = { v: 2, wallets: [], settings: { endpoints: [], pageSize: 20, chainListUrl: '', priceUrl: '', hideScam: false, slipShow: SLIP_SHOW_DEFAULT, proxyUrl: '', chains: [] } };

export const ERC20_RE = /^0x[0-9a-fA-F]{40}$/;
export const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** ตรวจว่าเป็นที่อยู่แบบไหน — ERC-20 ปรับเป็นตัวพิมพ์เล็ก, Solana ต้องคงตัวพิมพ์เดิม (base58 แยกตัวพิมพ์) */
export function parseAddress(raw: string): { address: string; family: Family } | null {
  const a = raw.trim();
  if (ERC20_RE.test(a)) return { address: a.toLowerCase(), family: 'erc20' };
  if (SOL_RE.test(a)) return { address: a, family: 'sol' };
  return null;
}

/** ล้างรายการแท็ก: ตัดช่องว่าง ทิ้งตัวว่าง ไม่เอาซ้ำ และคงลำดับที่ผู้ใช้ใส่ */
export function cleanTags(list: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of list) {
    const v = typeof raw === 'string' ? raw.trim() : '';
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

/** อ่านแท็กจากข้อมูลที่บันทึกไว้ — เวอร์ชันเก่าเก็บเป็นสตริงเดี่ยวชื่อ tag */
function readTags(w: Record<string, unknown>): string[] {
  if (Array.isArray(w.tags)) return cleanTags(w.tags as string[]);
  return typeof w.tag === 'string' ? cleanTags([w.tag]) : [];
}

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    // เบราว์เซอร์นี้ยังไม่เคยมีข้อมูล → เริ่มจากค่าที่ตั้งไว้ตอน build (ถ้ามี) จากนั้นผู้ใช้แก้ได้เองตลอด
    const cfg = buildConfig();
    if (!raw) return { ...DEFAULT, cfg: cfg.fingerprint, settings: { ...DEFAULT.settings, ...applyBuildConfig({ endpoints: [], chainListUrl: '', chains: [] }, cfg) } };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const wallets = Array.isArray(parsed.wallets) ? (parsed.wallets as Wallet[]) : [];
    const s = (parsed.settings ?? {}) as Partial<Settings> & { endpoint?: string };
    // v1 เก็บแหล่งข้อมูลเดียวเป็นสตริง → กลายเป็นรายการหนึ่งรายการ (ERC-20)
    const saved: Endpoint[] = Array.isArray(s.endpoints) ? s.endpoints : s.endpoint ? [{ id: 'ep1', name: 'ERC-20', url: s.endpoint, family: 'erc20', enabled: true }] : [];
    const merged = applyBuildConfig(
      {
        endpoints: saved.map((e) => ({ ...e, family: toFamily(e.family) })),
        chainListUrl: typeof s.chainListUrl === 'string' ? s.chainListUrl : '',
        chains: Array.isArray(s.chains) ? (s.chains as ChainOverride[]).filter((c) => c && typeof c.id === 'string') : [],
        ...(typeof parsed.cfg === 'string' ? { cfg: parsed.cfg } : {}),
      },
      cfg
    );
    const endpoints: Endpoint[] = merged.endpoints.map((e) => ({ ...e, family: toFamily(e.family) }));
    return {
      v: 2,
      wallets: wallets.flatMap((w) => {
        const p = w && typeof w.address === 'string' ? parseAddress(w.address) : null;
        const tags = readTags(w as unknown as Record<string, unknown>);
        return p ? [{ id: p.address, label: w.label ?? '', address: p.address, family: p.family, enabled: w.enabled !== false, ...(tags.length ? { tags } : {}) }] : [];
      }),
      cfg: cfg.fingerprint,
      settings: { endpoints, pageSize: typeof s.pageSize === 'number' ? s.pageSize : 20, chainListUrl: merged.chainListUrl, priceUrl: typeof s.priceUrl === 'string' ? s.priceUrl : '', hideScam: s.hideScam === true, slipShow: { ...SLIP_SHOW_DEFAULT, ...(typeof s.slipShow === 'object' && s.slipShow ? s.slipShow : {}) }, proxyUrl: typeof s.proxyUrl === 'string' ? s.proxyUrl : '', chains: merged.chains },
    };
  } catch {
    return DEFAULT;
  }
}

let state: State = load();
const listeners = new Set<() => void>();

function commit(next: State) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode — แอปยังใช้ได้ในหน่วยความจำ */
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

const uid = () => Math.random().toString(36).slice(2, 10);

/**
 * ตรวจแหล่งข้อมูลจาก URL ที่ผู้ใช้วาง — ไม่มีการตั้งค่ามือ
 * ตระกูลเชน: มีคำว่า sol/solana ใน host หรือ path → Solana, นอกนั้น ERC-20
 * ชื่อ: host โดยตัด www./api. ข้างหน้า
 */
export function detectEndpoint(url: string): { name: string; family: Family } | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || !u.hostname.includes('.')) return null;
  const probe = `${u.hostname}${u.pathname}`.toLowerCase();
  const family: Family = /\bsol(ana)?\b|solana|[/._-]sol[/._-]/.test(probe) ? 'sol' : 'erc20';
  const name = u.hostname.replace(/^(www|api)\./, '') || u.hostname;
  return { name, family };
}

/** ข้อมูลที่พกข้ามเครื่องได้ (สำรอง/แชร์) — อ่านสถานะปัจจุบันแบบไม่ผูกกับ React */
export function snapshot(): { wallets: Wallet[]; settings: Settings } {
  return { wallets: state.wallets, settings: state.settings };
}

/** เขียนสถานะกลับทั้งก้อน (กู้คืน/รวมข้อมูล) — ผ่าน commit ตัวเดียวกับที่ UI ใช้ จึงบันทึกและแจ้งทุกหน้าจอเอง */
export function applySnapshot(next: { wallets: Wallet[]; settings: Settings }): void {
  commit({ v: 2, wallets: next.wallets, settings: next.settings });
}

export function useStore() {
  const s = useSyncExternalStore(subscribe, () => state);

  const addWallets = useCallback((items: Array<{ label: string; address: string }>): number => {
    const have = new Set(state.wallets.map((w) => w.address));
    const fresh: Wallet[] = [];
    for (const it of items) {
      const p = parseAddress(it.address);
      if (!p || have.has(p.address)) continue;
      have.add(p.address);
      fresh.push({ id: p.address, label: it.label.trim() || p.address.slice(0, 8), address: p.address, family: p.family, enabled: true });
    }
    if (fresh.length) commit({ ...state, wallets: [...state.wallets, ...fresh] });
    return fresh.length;
  }, []);

  const removeWallet = useCallback((id: string) => commit({ ...state, wallets: state.wallets.filter((w) => w.id !== id) }), []);
  const toggleWallet = useCallback((id: string, enabled: boolean) => commit({ ...state, wallets: state.wallets.map((w) => (w.id === id ? { ...w, enabled } : w)) }), []);
  /* แท็กของกระเป๋า: รายการว่าง = ถอดแท็กออกหมด (ไม่เก็บช่องว่างไว้ในข้อมูล) */
  const setWalletTags = useCallback((id: string, tags: readonly string[]) => {
    const next = cleanTags(tags);
    commit({ ...state, wallets: state.wallets.map((w) => (w.id === id ? { ...w, tags: next.length ? next : undefined } : w)) });
  }, []);
  const clearWallets = useCallback(() => commit({ ...state, wallets: [] }), []);
  const removeWallets = useCallback((ids: Set<string>) => commit({ ...state, wallets: state.wallets.filter((w) => !ids.has(w.id)) }), []);
  /* ลากเรียงลำดับ: ย้ายรายการจาก index หนึ่งไปอีก index */
  const reorderWallets = useCallback((from: number, to: number) => {
    if (from === to) return;
    const next = [...state.wallets];
    const [item] = next.splice(from, 1);
    if (!item) return;
    next.splice(to, 0, item);
    commit({ ...state, wallets: next });
  }, []);

  const addEndpoint = useCallback((e: Omit<Endpoint, 'id' | 'enabled'>) => {
    commit({ ...state, settings: { ...state.settings, endpoints: [...state.settings.endpoints, { ...e, id: uid(), enabled: true }] } });
  }, []);
  const updateEndpoint = useCallback((id: string, patch: Partial<Endpoint>) => {
    commit({ ...state, settings: { ...state.settings, endpoints: state.settings.endpoints.map((e) => (e.id === id ? { ...e, ...patch } : e)) } });
  }, []);
  const reorderEndpoints = useCallback((from: number, to: number) => {
    if (from === to) return;
    const next = [...state.settings.endpoints];
    const [item] = next.splice(from, 1);
    if (!item) return;
    next.splice(to, 0, item);
    commit({ ...state, settings: { ...state.settings, endpoints: next } });
  }, []);
  const removeEndpoint = useCallback((id: string) => {
    commit({ ...state, settings: { ...state.settings, endpoints: state.settings.endpoints.filter((e) => e.id !== id) } });
  }, []);
  const setChainListUrl = useCallback((chainListUrl: string) => commit({ ...state, settings: { ...state.settings, chainListUrl: chainListUrl.trim() } }), []);
  const setPriceUrl = useCallback((priceUrl: string) => commit({ ...state, settings: { ...state.settings, priceUrl: priceUrl.trim() } }), []);
  const setHideScam = useCallback((hideScam: boolean) => commit({ ...state, settings: { ...state.settings, hideScam } }), []);
  const setProxyUrl = useCallback((proxyUrl: string) => commit({ ...state, settings: { ...state.settings, proxyUrl: proxyUrl.trim() } }), []);
  /* เชนกำหนดเอง: id เดิม = แทนที่ */
  const setChain = useCallback((c: ChainOverride) => {
    const id = c.id.trim().toLowerCase();
    if (!id) return;
    const rest = state.settings.chains.filter((x) => x.id !== id);
    commit({ ...state, settings: { ...state.settings, chains: [...rest, { ...c, id }] } });
  }, []);
  const removeChain = useCallback((id: string) => commit({ ...state, settings: { ...state.settings, chains: state.settings.chains.filter((x) => x.id !== id) } }), []);
  const setSlipShow = useCallback((field: SlipField, on: boolean) => commit({ ...state, settings: { ...state.settings, slipShow: { ...state.settings.slipShow, [field]: on } } }), []);
  const setPageSize = useCallback((pageSize: number) => commit({ ...state, settings: { ...state.settings, pageSize } }), []);

  const restore = useCallback((next: { wallets: Wallet[]; settings: Settings }) => applySnapshot(next), []);

  return { wallets: s.wallets, settings: s.settings, restore, addWallets, removeWallet, removeWallets, reorderWallets, toggleWallet, setWalletTags, clearWallets, addEndpoint, updateEndpoint, reorderEndpoints, removeEndpoint, setPageSize, setChainListUrl, setPriceUrl, setHideScam, setSlipShow, setProxyUrl, setChain, removeChain };
}
