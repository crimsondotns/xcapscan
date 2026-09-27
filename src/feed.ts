import { rememberPrice } from './prices';
import { requestUrl, viaWrapper } from './proxy';
import { limitedFetch } from './limiter';
/**
 * ดึงประวัติจาก URL แม่แบบที่ผู้ใช้ใส่เอง แล้วแปลงเป็นแถวกลางของแอป
 *
 * แอปไม่รู้จักแหล่งข้อมูลใดๆ ล่วงหน้า — รู้แค่ว่าแม่แบบมี {address} {start} {count}
 * และคำตอบเป็น JSON รูปแบบใดรูปแบบหนึ่งด้านล่าง ถ้าไม่ตรงก็รายงานว่าไม่รู้จัก
 */

export type TxType = 'swap' | 'send' | 'receive' | 'approve' | 'contract';

export interface Move {
  dir: 'in' | 'out';
  amount: number;
  symbol: string;
  /** ชื่อเต็มของโทเคน (ถ้ามี) */
  name: string | null;
  usd: number | null;
  /** ราคาต่อหน่วย (USD) ณ เวลานั้น ถ้าแหล่งข้อมูลให้มา */
  price: number | null;
  /** ที่อยู่สัญญาโทเคน (null = เหรียญพื้นเมืองของเชน) */
  tokenId: string | null;
  flagged: boolean;
  /** โลโก้โทเคนจากแหล่งข้อมูล (ถ้ามี) — ไม่มีก็ใช้ตัวอักษรแทน */
  logo: string | null;
  /** อนุมัติวงเงิน (approve) — ไม่มีเหรียญเคลื่อนจริง จำนวนคือ allowance ห้ามนับเป็นส่ง/รับ */
  approve?: true;
  /** จำนวนยังเป็นหน่วยดิบ (ยังไม่หาร 10^decimals) — รอ metadata ของโทเคนมาแปลง */
  rawUnits?: true;
}

export interface TxRow {
  key: string;
  hash: string;
  walletId: string;
  chain: string;
  /** โลโก้เชนจากแหล่งข้อมูล (ถ้ามี) */
  chainLogo: string | null;
  /** symbol ของเหรียญพื้นเมืองของเชน (ค่าธรรมเนียม) — จาก token_dict[chain] */
  nativeSymbol: string | null;
  time: number;
  type: TxType;
  name: string;
  failed: boolean;
  flagged: boolean;
  moves: Move[];
  counterparty: string | null;
  counterpartyName: string | null;
  /** ผู้ส่ง / ผู้รับ / สัญญาที่ถูกเรียก / nonce — ตามที่แหล่งข้อมูลให้ */
  from: string | null;
  to: string | null;
  contract: string | null;
  nonce: number | null;
  gasUsd: number | null;
  /** ค่าธรรมเนียมเป็นเหรียญพื้นเมืองของเชน (ถ้ามี) */
  gasNative: number | null;
  /** ทุกฟิลด์ที่แหล่งข้อมูลส่งมา — โชว์ในแผงรายละเอียด */
  raw: Record<string, unknown>;
}

export interface Cursor {
  /** เวลาของแถวเก่าสุดในหน้า → {start} */
  start: number;
  /** hash/signature ของแถวสุดท้าย → {cursor} (แหล่งข้อมูลบางแบบเลื่อนหน้าด้วยอันนี้) */
  cursor: string;
  /** จำนวนแถวที่ดึงจากแหล่งนี้มาแล้ว (สะสม) → {offset} (เลื่อนหน้าแบบ offset=100, 200, …) */
  offset: number;
  /** ค่า next ที่แหล่งส่งมาในคำตอบ → {next} (แหล่งที่เลื่อนหน้าด้วย token ของตัวเอง) */
  next?: string;
}

export interface Page {
  rows: TxRow[];
  /** ใช้ขอหน้าถัดไป; null = ไม่มีต่อ */
  next: Cursor | null;
}

export class FeedError extends Error {
  constructor(
    public kind: 'http' | 'net' | 'shape',
    public status = 0
  ) {
    super(kind);
  }
}

export function hasPlaceholder(tpl: string): boolean {
  return tpl.includes('{address}');
}

/**
 * base URL ที่ไม่มี {address} → แอปต่อ query ให้เอง (id / start_time / page_count)
 * ต่อท้าย ? หรือ & ที่มีอยู่แล้วให้ถูกต้อง
 */
/**
 * URL ที่ไม่มี placeholder → ประกอบให้ตามตระกูล:
 *  erc20: ?id={address}&start_time={start}&page_count={count}
 *  sol: ?ownerAddress={address}&limit={count}&offset={offset}  (หน้าแรกไม่ส่ง offset)
 * แหล่งที่ใช้ชื่อพารามิเตอร์/รูปแบบอื่น → วาง URL ที่มี {address} {count} {cursor} {start} {offset} {next} เองได้
 */
/** พารามิเตอร์ที่ผู้ใช้วางมาแบบว่าง (?ownerAddress หรือ &limit=) → เติม placeholder ลงไปแทนที่จะต่อซ้ำ */
function fillEmptyParam(url: string, name: string, value: string): string | null {
  const re = new RegExp(`([?&]${name})(=?)(?=&|$)`);
  return re.test(url) ? url.replace(re, `$1=${value}`) : null;
}

const PARAMS: Record<'erc20' | 'sol', Array<[string, string]>> = {
  erc20: [
    ['id', '{address}'],
    ['start_time', '{start}'],
    ['page_count', '{count}'],
  ],
  sol: [
    ['ownerAddress', '{address}'],
    ['limit', '{count}'],
    ['offset', '{offset}'],
  ],
};

export function toTemplate(url: string, family: 'erc20' | 'sol' = 'erc20'): string {
  let u = url.trim();
  if (hasPlaceholder(u)) return u;
  // 1) พารามิเตอร์ว่างที่มีอยู่แล้ว → เติม placeholder ตรงนั้น (คงพารามิเตอร์อื่นของผู้ใช้ไว้ เช่น flag เพิ่มเติม)
  const missing: Array<[string, string]> = [];
  for (const [name, ph] of PARAMS[family]) {
    const filled = fillEmptyParam(u, name, ph);
    if (filled) u = filled;
    else if (!new RegExp(`[?&]${name}=`).test(u)) missing.push([name, ph]);
  }
  // 2) ที่เหลือต่อท้าย
  if (missing.length) {
    const sep = u.endsWith('?') || u.endsWith('&') ? '' : u.includes('?') ? '&' : '?';
    u = `${u}${sep}${missing.map(([n, ph]) => `${n}=${ph}`).join('&')}`;
  }
  return u;
}

export function buildUrl(tpl: string, address: string, cur: Cursor | null, count: number, family: 'erc20' | 'sol' = 'erc20'): string {
  let t = toTemplate(tpl, family);
  // หน้าแรก (ไม่มี cursor) → ตัดพารามิเตอร์ที่ถือ {cursor}/{offset} ทิ้งทั้งคู่ (ไม่ส่ง before= ว่าง / offset=0)
  if (!cur) t = t.replace(/[?&][^&=]+=\{(cursor|offset|next)\}/g, (m) => (m.startsWith('?') ? '?' : '')).replace(/\?&/, '?').replace(/[?&]$/, '');
  return t
    .replaceAll('{address}', encodeURIComponent(address))
    .replaceAll('{start}', String(cur?.start ?? 0))
    .replaceAll('{cursor}', cur ? encodeURIComponent(cur.cursor) : '')
    // {offset}: แหล่งที่ส่ง next มาให้ใช้ token นั้น (เช่น offset=<next>) ไม่งั้นเป็นจำนวนแถวสะสม
    .replaceAll('{offset}', cur?.next ? encodeURIComponent(cur.next) : String(cur?.offset ?? 0))
    .replaceAll('{next}', cur?.next ? encodeURIComponent(cur.next) : '')
    .replaceAll('{count}', String(count));
}

export interface FetchOpts {
  family?: 'erc20' | 'sol';
  /** header ยืนยันตัวตนที่ผู้ใช้ตั้งเอง (ชื่อ + ค่า) — เก็บในเครื่องเท่านั้น */
  authHeader?: string;
  apiKey?: string;
}

export async function fetchPage(tpl: string, walletId: string, address: string, cur: Cursor | null, count: number, opts: FetchOpts = {}): Promise<Page> {
  let res: Response;
  const headers: Record<string, string> = { accept: 'application/json' };
  // ผ่าน API wrapper → ฝั่งเซิร์ฟเวอร์เป็นคนใส่กุญแจ เบราว์เซอร์ต้องไม่ส่งไปเอง
  if (!viaWrapper(tpl) && opts.authHeader && opts.apiKey) headers[opts.authHeader] = opts.apiKey;
  try {
    res = await limitedFetch(requestUrl(buildUrl(tpl, address, cur, count, opts.family)), { headers });
  } catch {
    throw new FeedError('net');
  }
  if (!res.ok) throw new FeedError('http', res.status);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new FeedError('shape');
  }
  const page = normalize(body, walletId, address);
  return { ...page, rows: markRisk(page.rows) };
}

/**
 * เหรียญที่ถูกโยนใส่กระเป๋าโดยไม่มีมูลค่าเลย = สแปมแจกเหรียญ (คนโยนอยากให้ไปเปิดเว็บของเขา)
 * เงื่อนไขครบทุกข้อเท่านั้น: เป็นขารับล้วน · ทุกก้อนไม่มีราคา/ราคาเป็นศูนย์ · เราไม่ได้จ่ายค่าธรรมเนียม
 * แถวที่จำนวนยังเป็นหน่วยดิบ (รอ decimals) ยังตัดสินไม่ได้ ปล่อยไว้ก่อน
 */
export function worthlessAirdrop(r: TxRow): boolean {
  if (r.type !== 'receive') return false;
  if (r.gasUsd !== null && r.gasUsd > 0) return false;
  const real = r.moves.filter((m) => m.amount !== 0 && !m.approve);
  if (!real.length || real.some((m) => m.dir === 'out' || m.rawUnits)) return false;
  return real.every((m) => m.usd === null || m.usd === 0);
}

/** ติดธงเพิ่มจากสิ่งที่เห็นในแถวเอง — ของเดิมที่แหล่งข้อมูลติดมาแล้วไม่ถูกถอด */
export function markRisk(rows: TxRow[]): TxRow[] {
  return rows.map((r) => (worthlessAirdrop(r) && !r.flagged ? { ...r, flagged: true, moves: r.moves.map((m) => ({ ...m, flagged: true })) } : r));
}

/* ----------------------------- normalizer ----------------------------- */

type Dict = Record<string, unknown>;
const isObj = (v: unknown): v is Dict => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
/** รับเฉพาะ https รูปภาพจากแหล่งข้อมูล — กัน javascript:/data: ที่อาจแทรกมา */
/** symbol ที่มีอักษรนอก ASCII (เช่น Ỵ แทน Y) = ชื่อเลียนแบบ ให้ติดธงน่าสงสัยเอง */
export const lookalike = (symbol: string): boolean => /[^\x20-\x7E]/.test(symbol);
const httpUrl = (v: unknown): string | null => (typeof v === 'string' && /^https:\/\//i.test(v) ? v : null);

function normalize(body: unknown, walletId: string, address: string): Page {
  if (isObj(body) && Array.isArray(body.history_list)) return fromHistoryList(body, walletId, address);
  if (isObj(body) && Array.isArray(body.transfers)) return fromTransferList(body, walletId, address);
  const pnl = isObj(body) ? (Object.values(body).find((v) => isObj(v) && Array.isArray(v.userTrades)) as Dict | undefined) : undefined;
  if (pnl) return fromUserTrades(pnl, walletId);
  const list = Array.isArray(body) ? body : isObj(body) ? (['result', 'data', 'activities', 'items', 'transactions', 'txs'].map((k) => body[k]).find(Array.isArray) ?? (isObj(body.data) ? ['activities', 'items', 'list'].map((k) => (body.data as Dict)[k]).find(Array.isArray) : null) ?? null) : null;
  if (!list) throw new FeedError('shape');
  if (list.some((x) => isObj(x) && typeof x.tokenAddress === 'string' && (typeof x.isBuy === 'boolean' || x.solAmount !== undefined))) return fromTradeList(list, walletId);
  if (list.some((x) => isObj(x) && (typeof x.signature === 'string' || Array.isArray(x.tokenTransfers) || Array.isArray(x.nativeTransfers)))) return fromSignatureList(list, walletId, address);
  return fromFlatList(list, walletId, address);
}

/** รูปแบบ A: { history_list[], token_dict, project_dict } */
function fromHistoryList(body: Dict, walletId: string, address: string): Page {
  const tokens = isObj(body.token_dict) ? body.token_dict : {};
  const projects = isObj(body.project_dict) ? body.project_dict : {};
  const rows: TxRow[] = [];
  for (const item of body.history_list as unknown[]) {
    if (!isObj(item)) continue;
    const hash = str(item.id) ?? '';
    const time = num(item.time_at) ?? 0;
    const tx = isObj(item.tx) ? item.tx : {};
    const chain = str(item.chain) ?? '—';
    const moves: Move[] = [];
    let flagged = item.is_scam === true;
    const push = (dir: Move['dir'], list: unknown) => {
      if (!Array.isArray(list)) return;
      for (const m of list) {
        if (!isObj(m)) continue;
        const tokenId = str(m.token_id) ?? '';
        const tok = isObj(tokens[tokenId]) ? (tokens[tokenId] as Dict) : {};
        const amount = num(m.amount) ?? 0;
        const price = num(m.price) ?? num(tok.price);
        const symbol = str(tok.optimized_symbol) ?? str(tok.display_symbol) ?? str(tok.symbol) ?? shortId(tokenId);
        const bad = tok.is_scam === true || tok.is_suspicious === true || lookalike(symbol);
        if (bad) flagged = true;
        rememberPrice(chain, tokenId.startsWith('0x') || tokenId.length > 20 ? tokenId : null, symbol, price, time);
        moves.push({
          dir,
          amount,
          symbol,
          name: str(tok.name),
          usd: price !== null ? amount * price : null,
          price,
          tokenId: tokenId.startsWith('0x') || tokenId.length > 20 ? tokenId : null,
          flagged: bad,
          logo: httpUrl(tok.logo_url),
        });
      }
    };
    push('out', item.sends);
    push('in', item.receives);

    const approve = isObj(item.token_approve) ? item.token_approve : null;
    const name = str(tx.name) ?? '';
    const type: TxType = approve ? 'approve' : moves.some((m) => m.dir === 'in') && moves.some((m) => m.dir === 'out') ? 'swap' : moves.some((m) => m.dir === 'out') ? 'send' : moves.some((m) => m.dir === 'in') ? 'receive' : 'contract';
    if (approve) {
      const tok = isObj(tokens[str(approve.token_id) ?? '']) ? (tokens[str(approve.token_id) ?? ''] as Dict) : {};
      moves.push({ dir: 'out', amount: num(approve.value) ?? 0, symbol: str(tok.optimized_symbol) ?? str(tok.symbol) ?? '', name: str(tok.name), usd: null, price: num(tok.price), tokenId: str(approve.token_id)?.startsWith('0x') ? str(approve.token_id) : null, flagged: false, logo: httpUrl(tok.logo_url), approve: true });
    }

    const projectId = str(item.project_id);
    const project = projectId && isObj(projects[projectId]) ? (projects[projectId] as Dict) : null;
    const other = str(item.other_addr) ?? (str(tx.from_addr)?.toLowerCase() === address ? str(tx.to_addr) : str(tx.from_addr));
    // โอนโทเคน: tx.to_addr คือสัญญาโทเคน ไม่ใช่ผู้รับ — ผู้รับจริงอยู่ที่ sends[].to_addr / other_addr; ขารับก็เช่นกัน (receives[].from_addr)
    const sendTo = Array.isArray(item.sends) ? item.sends.map((m) => (isObj(m) ? str(m.to_addr) : null)).find((v): v is string => !!v) : undefined;
    const recvFrom = Array.isArray(item.receives) ? item.receives.map((m) => (isObj(m) ? str(m.from_addr) : null)).find((v): v is string => !!v) : undefined;
    const isTokenTransfer = !approve && !projectId && (str(tx.name) === 'transfer' || str(tx.name) === 'transferFrom' || (num(tx.value) === 0 && moves.length === 1));
    // ขารับอย่างเดียว: ผู้ส่งคือ receives[].from_addr (ไม่มีก็ other_addr = คู่ธุรกรรม), ผู้รับคือกระเป๋านี้เอง
    //   (เดิมใช้ other_addr เป็นผู้รับ → จาก/ถึง กลายเป็นกระเป๋าเดียวกัน)
    const receiveOnly = type === 'receive';
    const fromAddr = isTokenTransfer && recvFrom ? recvFrom : isTokenTransfer && receiveOnly && other ? other : str(tx.from_addr);
    // approve: ผู้รับคือ spender (โปรโตคอลที่ได้สิทธิ์) ส่วน tx.to_addr คือสัญญาโทเคน
    const toAddr = approve ? (str(approve.spender) ?? other ?? str(tx.to_addr)) : isTokenTransfer ? (receiveOnly ? address : (sendTo ?? other ?? str(tx.to_addr))) : str(tx.to_addr);

    // เหรียญพื้นเมือง: key ใน token_dict = ชื่อเชน (hood → ETH, hyper → HYPE)
    const native = isObj(tokens[chain]) ? (tokens[chain] as Dict) : {};
    const nativeSymbol = str(native.optimized_symbol) ?? str(native.symbol);
    rememberPrice(chain, null, nativeSymbol ?? '', num(native.price), time);
    const gasNative = num(tx.eth_gas_fee);
    const gasUsd = num(tx.usd_gas_fee);
    if (gasNative && gasUsd) rememberPrice(chain, null, nativeSymbol ?? '', gasUsd / gasNative, time);
    rows.push({
      key: `${walletId}:${chain}:${hash}:${num(item.idx) ?? 0}`,
      hash,
      walletId,
      chain,
      chainLogo: httpUrl(item.chain_logo_url),
      nativeSymbol,
      time,
      type,
      name,
      failed: num(tx.status) === 0,
      flagged,
      moves,
      counterparty: other,
      // ชื่อโปรโตคอล: จาก project_dict ก่อน ไม่มีค่อยเดาจาก project_id (ตัด prefix เชน เช่น arb_lifiprotocol → Lifiprotocol)
      counterpartyName: (project ? str(project.name) : null) ?? (projectId ? prettyProjectId(projectId, chain) : null),
      from: fromAddr,
      to: toAddr,
      contract: projectId || approve || type === 'swap' || type === 'contract' ? str(tx.to_addr) : null,
      nonce: num(tx.nonce),
      gasUsd,
      gasNative,
      raw: item,
    });
  }
  return { rows, next: cursorOf(rows) };
}

/** รูปแบบ B: รายการแบน [{ hash, from, to, value, timeStamp, … }] หรือ { result: [...] } */
function fromFlatList(list: unknown[], walletId: string, address: string): Page {
  const rows: TxRow[] = [];
  for (const item of list) {
    if (!isObj(item)) continue;
    const hash = str(item.hash) ?? str(item.txHash) ?? str(item.id) ?? '';
    const from = (str(item.from) ?? str(item.from_addr) ?? '').toLowerCase();
    const to = (str(item.to) ?? str(item.to_addr) ?? '').toLowerCase();
    const rawTime = num(item.timeStamp) ?? num(item.timestamp) ?? num(item.time_at) ?? 0;
    const time = rawTime > 1e12 ? Math.floor(rawTime / 1000) : rawTime;
    const decimals = num(item.tokenDecimal) ?? 18;
    const raw = num(item.value) ?? 0;
    const amount = str(item.tokenDecimal) || raw > 1e15 ? raw / 10 ** decimals : raw;
    const out = from === address;
    const flatToken = str(item.contractAddress) ?? str(item.token_id) ?? str(item.tokenAddress) ?? str(item.mint) ?? null;
    const symbol = str(item.tokenSymbol) ?? str(item.symbol) ?? (flatToken ? shortId(flatToken) : '');
    const flatChain = str(item.chain) ?? '—';
    const flatPrice = num(item.price) ?? num(item.tokenPrice);
    rememberPrice(flatChain, flatToken, symbol, flatPrice, time);
    const moves: Move[] = amount > 0 ? [{ dir: out ? 'out' : 'in', amount, symbol, name: str(item.tokenName) ?? str(item.name), usd: num(item.usd) ?? num(item.valueUsd), price: flatPrice, tokenId: flatToken, flagged: lookalike(symbol), logo: httpUrl(item.tokenLogo) ?? httpUrl(item.logo_url) ?? httpUrl(item.image) ?? httpUrl(item.logo) }] : [];
    const gasPrice = num(item.gasPrice);
    const gasUsed = num(item.gasUsed);
    rows.push({
      key: `${walletId}:${hash}:${rows.length}`,
      hash,
      walletId,
      chain: str(item.chain) ?? '—',
      chainLogo: httpUrl(item.chain_logo_url),
      nativeSymbol: str(item.nativeSymbol),
      time,
      type: moves.length ? (out ? 'send' : 'receive') : 'contract',
      name: str(item.functionName)?.split('(')[0] ?? str(item.name) ?? '',
      failed: str(item.isError) === '1' || num(item.status) === 0,
      flagged: moves.some((m) => m.flagged),
      moves,
      counterparty: out ? to || null : from || null,
      counterpartyName: null,
      from: from || null,
      to: to || null,
      contract: str(item.contractAddress),
      nonce: num(item.nonce),
      gasUsd: gasPrice !== null && gasUsed !== null ? null : num(item.usd_gas_fee),
      gasNative: gasPrice !== null && gasUsed !== null ? (gasPrice * gasUsed) / 1e18 : null,
      raw: item,
    });
  }
  return { rows, next: cursorOf(rows) };
}

/** รูปแบบ C: รายการธุรกรรมแบบ signature (เชนตระกูล Solana) — { signature, timestamp, type, fee, feePayer, nativeTransfers[], tokenTransfers[] } */
function fromSignatureList(list: unknown[], walletId: string, address: string): Page {
  const rows: TxRow[] = [];
  for (const item of list) {
    if (!isObj(item)) continue;
    const hash = str(item.signature) ?? str(item.txHash) ?? str(item.id) ?? '';
    const rawTime = num(item.timestamp) ?? num(item.blockTime) ?? num(item.time) ?? 0;
    const time = rawTime > 1e12 ? Math.floor(rawTime / 1000) : rawTime;
    const moves: Move[] = [];
    let other: string | null = null;
    const push = (list: unknown, native: boolean) => {
      if (!Array.isArray(list)) return;
      for (const m of list) {
        if (!isObj(m)) continue;
        const from = str(m.fromUserAccount) ?? str(m.from) ?? '';
        const to = str(m.toUserAccount) ?? str(m.to) ?? '';
        if (from !== address && to !== address) continue;
        const dir: Move['dir'] = from === address ? 'out' : 'in';
        other ??= dir === 'out' ? to || null : from || null;
        const amount = native ? (num(m.amount) ?? 0) / 1e9 : (num(m.tokenAmount) ?? num(m.amount) ?? 0);
        const mint = native ? null : (str(m.mint) ?? str(m.tokenAddress) ?? str(m.address));
        const symbol = native ? 'SOL' : (str(m.symbol) ?? shortId(mint ?? ''));
        const solUsd = num(m.usd);
        const solPrice = num(m.price) ?? num(m.priceUsd) ?? (solUsd !== null && amount ? solUsd / amount : null);
        rememberPrice(str(item.chain) ?? 'sol', mint, symbol, solPrice, time);
        moves.push({ dir, amount, symbol, name: str(m.name), usd: solUsd, price: solPrice, tokenId: mint, flagged: lookalike(symbol), logo: native ? null : (httpUrl(m.logo) ?? httpUrl(m.image) ?? httpUrl(m.logo_url)) });
      }
    };
    push(item.nativeTransfers, true);
    push(item.tokenTransfers, false);
    const hasIn = moves.some((m) => m.dir === 'in');
    const hasOut = moves.some((m) => m.dir === 'out');
    const kind = (str(item.type) ?? '').toLowerCase();
    const type: TxType = kind.includes('swap') || (hasIn && hasOut) ? 'swap' : hasOut ? 'send' : hasIn ? 'receive' : 'contract';
    const fee = num(item.fee);
    rows.push({
      key: `${walletId}:sol:${hash}`,
      hash,
      walletId,
      chain: str(item.chain) ?? 'sol',
      chainLogo: httpUrl(item.chain_logo_url),
      nativeSymbol: 'SOL',
      time,
      type,
      name: kind && kind !== 'unknown' ? kind : (str(item.source) ?? ''),
      failed: item.transactionError !== null && item.transactionError !== undefined && item.transactionError !== false,
      flagged: moves.some((m) => m.flagged),
      moves,
      counterparty: other,
      counterpartyName: null,
      from: str(item.feePayer),
      to: other,
      contract: str(item.source),
      nonce: null,
      gasUsd: fee !== null && str(item.feePayer) === address ? num(item.feeUsd) : null,
      gasNative: fee !== null && str(item.feePayer) === address ? fee / 1e9 : null,
      raw: item,
    });
  }
  return { rows, next: cursorOf(rows) };
}

/**
 * รูปแบบ D: รายการเทรดโทเคน (Solana) — { tokenAddress, signature, time (ISO), tokenAmount (หน่วยดิบ), solAmount (lamports), solPrice, usdPrice, isBuy }
 * ซื้อ = จ่าย SOL รับโทเคน / ขาย = ส่งโทเคน รับ SOL; จำนวนโทเคนเป็นหน่วยดิบ รอ decimals จาก metadata (applyTokenMeta) — ไม่มีค่าธรรมเนียม/คู่สัญญาในข้อมูล
 */
function fromTradeList(list: unknown[], walletId: string): Page {
  const rows: TxRow[] = [];
  for (const item of list) {
    if (!isObj(item)) continue;
    const hash = str(item.signature) ?? '';
    const mint = str(item.tokenAddress) ?? '';
    const t = item.time;
    const time = typeof t === 'string' ? Math.floor(Date.parse(t) / 1000) || 0 : (num(t) ?? 0) > 1e12 ? Math.floor((num(t) ?? 0) / 1000) : (num(t) ?? 0);
    const chain = str(item.chain) ?? 'sol';
    const buy = item.isBuy === true;
    const rawTok = num(item.tokenAmount) ?? 0;
    const sol = (num(item.solAmount) ?? 0) / 1e9;
    const usdPrice = num(item.usdPrice);
    const solPrice = num(item.solPrice);
    const solUsd = usdPrice !== null && solPrice ? usdPrice / solPrice : null;
    rememberPrice(chain, mint, shortId(mint), usdPrice, time);
    rememberPrice(chain, null, 'SOL', solUsd, time);
    const token: Move = { dir: buy ? 'in' : 'out', amount: rawTok, symbol: shortId(mint), name: null, usd: null, price: usdPrice, tokenId: mint, flagged: false, logo: null, rawUnits: true };
    const native: Move = { dir: buy ? 'out' : 'in', amount: sol, symbol: 'SOL', name: null, usd: solUsd !== null ? sol * solUsd : null, price: solUsd, tokenId: null, flagged: false, logo: null };
    rows.push({
      key: `${walletId}:sol:${hash}:${mint}`,
      hash,
      walletId,
      chain,
      chainLogo: null,
      nativeSymbol: 'SOL',
      time,
      type: 'swap',
      name: buy ? 'buy' : 'sell',
      failed: false,
      flagged: false,
      moves: buy ? [native, token] : [token, native],
      counterparty: null,
      counterpartyName: null,
      from: null,
      to: null,
      contract: null,
      nonce: null,
      gasUsd: null,
      gasNative: null,
      raw: item,
    });
  }
  return { rows, next: cursorOf(rows) };
}

/**
 * รูปแบบ E: { transfers: [{ txHash, blockTime, assetId, amount, amountRaw, usdVolume, fromAddress, toAddress, feeAmount, feePayer }], next }
 * การโอนเข้า/ออกของที่อยู่ (รวมเหรียญพื้นเมือง): ทิศจาก from/to, จำนวนเป็นทศนิยมแล้ว, สัญลักษณ์/โลโก้รอ metadata
 */
function fromTransferList(body: Dict, walletId: string, address: string): Page {
  const rows: TxRow[] = [];
  const chain = str(body.chain) ?? 'sol';
  for (const item of body.transfers as unknown[]) {
    if (!isObj(item)) continue;
    const hash = str(item.txHash) ?? '';
    const from = str(item.fromAddress);
    const to = str(item.toAddress);
    const out = from === address;
    const mint = str(item.assetId);
    const amount = num(item.amount) ?? 0;
    const usd = num(item.usdVolume);
    const price = usd !== null && amount ? usd / amount : null;
    const symbol = mint ? shortId(mint) : '';
    rememberPrice(chain, mint, symbol, price);
    const fee = num(item.feeAmount);
    rows.push({
      key: `${walletId}:${chain}:${hash}:${rows.length}`,
      hash,
      walletId,
      chain,
      chainLogo: null,
      nativeSymbol: 'SOL',
      time: Math.floor(Date.parse(str(item.blockTime) ?? '') / 1000) || (num(item.blockTime) ?? 0),
      type: out ? 'send' : 'receive',
      name: '',
      failed: false,
      flagged: false,
      moves: amount ? [{ dir: out ? 'out' : 'in', amount, symbol, name: null, usd, price, tokenId: mint, flagged: false, logo: null }] : [],
      counterparty: out ? to : from,
      counterpartyName: null,
      from,
      to,
      contract: null,
      nonce: null,
      gasUsd: null,
      gasNative: fee !== null && str(item.feePayer) === address ? fee : null,
      raw: item,
    });
  }
  return { rows, next: cursorOf(rows, str(body.next)) };
}

/**
 * รูปแบบ F: { "<address>": { userTrades: [{ type: buy|sell, assetId, amount, price, nativeVolume, usdVolume, blockTime, txHash }], next } }
 * เทรดกับ SOL: buy = จ่าย SOL รับโทเคน, sell = ส่งโทเคน รับ SOL — จำนวนเป็นทศนิยมแล้ว
 */
function fromUserTrades(wrap: Dict, walletId: string): Page {
  const rows: TxRow[] = [];
  const chain = str(wrap.chain) ?? 'sol';
  for (const item of wrap.userTrades as unknown[]) {
    if (!isObj(item)) continue;
    const hash = str(item.txHash) ?? '';
    const mint = str(item.assetId) ?? '';
    const buy = (str(item.type) ?? '').toLowerCase() === 'buy';
    const amount = num(item.amount) ?? 0;
    const price = num(item.price);
    const usd = num(item.usdVolume);
    const sol = num(item.nativeVolume) ?? 0;
    const solPrice = sol && usd !== null ? usd / sol : null;
    const symbol = shortId(mint);
    rememberPrice(chain, mint, symbol, price);
    rememberPrice(chain, null, 'SOL', solPrice);
    const token: Move = { dir: buy ? 'in' : 'out', amount, symbol, name: null, usd, price, tokenId: mint, flagged: false, logo: null };
    const native: Move = { dir: buy ? 'out' : 'in', amount: sol, symbol: 'SOL', name: null, usd, price: solPrice, tokenId: null, flagged: false, logo: null };
    rows.push({
      key: `${walletId}:${chain}:${hash}:${str(item.actionId) ?? rows.length}`,
      hash,
      walletId,
      chain,
      chainLogo: null,
      nativeSymbol: 'SOL',
      time: Math.floor(Date.parse(str(item.blockTime) ?? '') / 1000) || (num(item.blockTime) ?? 0),
      type: 'swap',
      name: buy ? 'buy' : 'sell',
      failed: false,
      flagged: false,
      moves: buy ? [native, token] : [token, native],
      counterparty: null,
      counterpartyName: null,
      from: str(item.signerId),
      to: null,
      contract: null,
      nonce: null,
      gasUsd: null,
      gasNative: null,
      raw: item,
    });
  }
  return { rows, next: cursorOf(rows, str(wrap.next)) };
}

function cursorOf(rows: TxRow[], next?: string | null): Cursor | null {
  if (!rows.length) return null;
  const oldest = rows.reduce((m, r) => (r.time > 0 && r.time < m.time ? r : m), rows[0]!);
  return { start: oldest.time, cursor: oldest.hash, offset: rows.length, ...(next ? { next } : {}) };
}

/** arb_lifiprotocol → "Lifiprotocol", eth_uniswap3 → "Uniswap3" — ใช้เมื่อแหล่งข้อมูลไม่ส่ง project_dict มาให้ */
export function prettyProjectId(id: string, chain: string): string {
  const body = id.startsWith(`${chain}_`) ? id.slice(chain.length + 1) : id.replace(/^[a-z0-9]+_/, '');
  return body
    .split(/[_-]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ');
}

function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 6)}…` : id || '?';
}

/* ----------------------------- token metadata ----------------------------- */

export interface TokenMeta {
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  logo: string | null;
}

/** โทเคนในหน้าที่ยังไม่รู้ชื่อ/สัญลักษณ์/โลโก้ — ไปขอ metadata เพิ่มจาก URL ที่ผู้ใช้ตั้ง */
export function unknownTokens(rows: TxRow[]): string[] {
  const ids = new Set<string>();
  for (const r of rows) for (const m of r.moves) if (m.tokenId && (m.rawUnits || m.name === null || m.logo === null || m.symbol.endsWith('…'))) ids.add(m.tokenId);
  return [...ids];
}

/** เติมชื่อ/สัญลักษณ์/โลโก้ลงแถว (แถวใหม่ ไม่แก้ของเดิม) */
export function applyTokenMeta(rows: TxRow[], meta: Map<string, TokenMeta>): TxRow[] {
  if (!meta.size) return rows;
  // ตัดสินความเสี่ยงอีกรอบหลังรู้ decimals/ราคาแล้ว (ตอนแรกยังเป็นหน่วยดิบ ตัดสินไม่ได้)
  return markRisk(rows.map((r) => {
    let touched = false;
    const moves = r.moves.map((m) => {
      const t = m.tokenId ? meta.get(m.tokenId) : undefined;
      if (!t) return m;
      touched = true;
      const symbol = m.symbol.endsWith('…') || !m.symbol ? (t.symbol ?? m.symbol) : m.symbol;
      // หน่วยดิบ + รู้ decimals แล้ว → แปลงเป็นจำนวนจริง และคิด USD จากราคาต่อหน่วย
      const { rawUnits, ...rest } = m;
      const amount = rawUnits && t.decimals !== null ? m.amount / 10 ** t.decimals : m.amount;
      const usd = rawUnits && t.decimals !== null && m.price !== null ? amount * m.price : m.usd;
      const keepRaw = rawUnits && t.decimals === null ? { rawUnits: true as const } : {};
      return { ...rest, ...keepRaw, amount, usd, symbol, name: m.name ?? t.name, logo: m.logo ?? t.logo, flagged: m.flagged || lookalike(symbol) };
    });
    return touched ? { ...r, moves, flagged: r.flagged || moves.some((m) => m.flagged) } : r;
  }));
}

/** แปลงคำตอบ metadata ทุกรูปที่พบ: รายการ [{address,…}] หรือ map { address: {…} } หรือห่อใน data/result */
export function parseTokenMeta(body: unknown): Map<string, TokenMeta> {
  const out = new Map<string, TokenMeta>();
  let list: unknown = body;
  if (isObj(list)) list = ['data', 'result', 'tokens', 'items'].map((k) => (list as Dict)[k]).find((v) => v !== undefined) ?? list;
  const add = (addr: string | null, v: unknown) => {
    if (!addr || !isObj(v)) return;
    out.set(addr, { name: str(v.name), symbol: str(v.symbol), decimals: num(v.decimals), logo: httpUrl(v.logoURI) ?? httpUrl(v.logo_uri) ?? httpUrl(v.logo) ?? httpUrl(v.image) ?? httpUrl(v.icon) ?? httpUrl(v.logo_url) ?? httpUrl(v.imageUrl) });
  };
  if (Array.isArray(list)) for (const v of list) add(isObj(v) ? (str(v.address) ?? str(v.mint) ?? str(v.tokenAddress) ?? str(v.id)) : null, v);
  else if (isObj(list)) for (const [k, v] of Object.entries(list)) add(k, v);
  return out;
}
