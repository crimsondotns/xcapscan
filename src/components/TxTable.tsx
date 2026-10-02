import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useInfinite } from '../useInfinite';
import { useStickyHead } from '../useStickyHead';
import { MoreSentinel } from './MoreSentinel';
import { SkeletonRows } from './Skeleton';
import { useI18n } from '../i18n';
import { useStore, type Wallet } from '../store';
import type { TxRow, TxType } from '../feed';
import { formatAmount, formatFeeNative, formatFeeUsd, formatRelative } from '../format';
import { Icon } from './Icon';
import { protocolKind } from '../kind';
import { Dropdown } from './Dropdown';
import { Logo } from './Logo';
import { chainOf, type ChainMap } from '../chains';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { RefreshCwIcon, SearchIcon } from 'lucide-react';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { AdvancedFilterButton, loadAdv, saveAdv, AdvancedFilterChips, advFromTs, advMatches, DateFields, type AdvFilter } from './AdvancedFilter';
import { TokenConds, passConds, liveConds, type TokenCond } from './BalanceFilter';
import { HeadFilter } from './HeadFilter';
import { useIsMobile } from '@/hooks/useIsMobile';
import { Spinner } from '@/components/ui/spinner';
import type { OlderOpts } from '../useFeed';
import { pausedFor } from '../limiter';

const TYPES: TxType[] = ['swap', 'send', 'receive', 'approve', 'contract'];
/** ตัวกรองชนิด: 'transfer' = โอน นับทั้งส่งและรับในอันเดียว ('' = ทุกประเภท) */
type TypeFilter = '' | 'transfer' | TxType;
const matchesType = (r: TxRow, f: TypeFilter): boolean => (f === '' ? true : f === 'transfer' ? r.type === 'send' || r.type === 'receive' : r.type === f);
/** คำค้นจับ hash / คู่ธุรกรรม / ชื่อธุรกรรม / สัญลักษณ์โทเคน (needle ตัวพิมพ์เล็กแล้ว) */
const matchNeedle = (r: TxRow, needle: string): boolean => !needle || r.hash.toLowerCase().includes(needle) || (r.counterparty ?? '').toLowerCase().includes(needle) || (r.counterpartyName ?? '').toLowerCase().includes(needle) || r.name.toLowerCase().includes(needle) || r.moves.some((m) => m.symbol.toLowerCase().includes(needle));
/** ตัวกรองของคอลัมน์ Type (กรวยในหัว จอ ≥640 — ผู้ใช้ 2026-10-02): เงื่อนไขค้นหาหลายแถว + ชนิด + เชน */
interface TypeHead {
  type: TypeFilter;
  chain: string;
  conds: TokenCond[];
}
type SortKey = 'type' | 'date' | 'amount' | 'fee';

/**
 * มูลค่าของแถว (USD) — "เงินที่เคลื่อน" ไม่ใช่ผลต่างสุทธิ
 * ส่งอย่างเดียว → −ยอดส่ง, รับอย่างเดียว → +ยอดรับ,
 * ทั้งส่งและรับ (สลับ) → ขนาดของธุรกรรม (ฝั่งที่ใหญ่กว่า) ไม่มีเครื่องหมาย
 * ก้อนที่จำนวน 0 หรือไม่มีราคา ไม่นับ
 */
export function rowValue(r: TxRow): { value: number; sign: '+' | '−' | '' } | null {
  let inUsd = 0;
  let outUsd = 0;
  let hasIn = false;
  let hasOut = false;
  for (const m of r.moves) {
    if (m.usd === null || m.amount === 0 || m.approve) continue;
    if (m.dir === 'in') {
      inUsd += m.usd;
      hasIn = true;
    } else {
      outUsd += m.usd;
      hasOut = true;
    }
  }
  if (hasIn && hasOut) return { value: Math.max(inUsd, outUsd), sign: '' };
  if (hasOut) return { value: outUsd, sign: '−' };
  if (hasIn) return { value: inUsd, sign: '+' };
  return null;
}

/** จำนวนโทเคนหลักของแถว (ก้อนแรกที่มีจำนวน) */
function mainMove(r: TxRow) {
  const real = r.moves.filter((m) => m.amount !== 0);
  return real.find((m) => m.usd !== null) ?? real[0] ?? r.moves[0] ?? null;
}

export function TxTable({ rows, wallets, chains: chainInfo, wallet, onWallet, onToken, selected, onSelect, loading = false, hasMore = false, onMore, onReload, bulk }: { rows: TxRow[]; wallets: Wallet[]; chains: ChainMap; wallet: string; onWallet: (id: string) => void; onToken?: (symbol: string) => void; selected: string | null; onSelect: (r: TxRow) => void; loading?: boolean; hasMore?: boolean; onMore?: (opts?: OlderOpts) => void; onReload?: () => void; bulk?: { count: number; seek: boolean } }) {
  const { t } = useI18n();
  const { settings, setHideScam } = useStore();
  const hideScam = settings.hideScam;
  const [q, setQ] = useState('');
  const [chain, setChain] = useState('');
  const [type, setType] = useState<TypeFilter>('');
  const [conds, setConds] = useState<TokenCond[]>([]);
  const mobile = useIsMobile();
  const typeHead: TypeHead = { type, chain, conds };
  const setTypeHead = (v: TypeHead) => {
    setType(v.type);
    setChain(v.chain);
    setConds(v.conds);
  };
  const [adv, setAdv] = useState<AdvFilter>(loadAdv);
  useEffect(() => saveAdv(adv), [adv]);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' });

  const labels = useMemo(() => new Map(wallets.map((w) => [w.id, w.label])), [wallets]);
  const chains = useMemo(() => [...new Set(rows.map((r) => r.chain))].sort(), [rows]);
  /* จำนวนของแต่ละตัวเลือกในแผง — นับจากแถวทั้งหมดของหน้านี้ ไม่ใช่หลังกรอง (ไม่งั้นทุกตัวเลือกอื่นเป็น 0) */
  const scope = useMemo(() => (wallet ? rows.filter((r) => r.walletId === wallet) : rows), [rows, wallet]);
  const countType = (f: TypeFilter) => scope.filter((r) => matchesType(r, f)).length;

  const PAGE = 25;
  const head = useStickyHead();
  /* ตัวกรองแถบเครื่องมือ (ไม่รวม advanced) — ใช้ทั้งกรองจริงและนับ "Show N results" ใน draft */
  const base = (r: TxRow, needle: string, h: TypeHead = typeHead) => {
    if (wallet && r.walletId !== wallet) return false;
    if (h.chain && r.chain !== h.chain) return false;
    if (!matchesType(r, h.type)) return false;
    if (hideScam && r.flagged) return false;
    if (!passConds(h.conds, (c) => matchNeedle(r, c.trim().toLowerCase()))) return false;
    return matchNeedle(r, needle);
  };
  const countFor = (f: AdvFilter, h: TypeHead = typeHead) => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => base(r, needle, h) && advMatches(r, f)).length;
  };
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = rows.filter((r) => advMatches(r, adv) && base(r, needle));
    const dir = sort.dir === 'asc' ? 1 : -1;
    const key = (r: TxRow): string | number => {
      switch (sort.key) {
        case 'type':
          return r.failed ? 'zz' : r.type;
        case 'amount': {
          const v = rowValue(r);
          return v ? (v.sign === '−' ? -v.value : v.value) : Number.NEGATIVE_INFINITY;
        }
        case 'fee':
          return r.gasUsd ?? Number.NEGATIVE_INFINITY;
        default:
          return r.time;
      }
    };
    return list.sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      const c = typeof ka === 'number' && typeof kb === 'number' ? ka - kb : String(ka).localeCompare(String(kb));
      return c * dir || b.time - a.time;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, wallet, chain, type, conds, sort, labels, hideScam, adv]);
  /*
   * กรองวันที่ → ดึงประวัติจากแหล่งข้อมูลย้อนหลังเองจนถึงวันเริ่มของช่วง (แหล่งข้อมูลไม่มีพารามิเตอร์วันที่ — เลื่อนหน้าด้วย offset/cursor)
   * ครอบคลุมแล้ว (แถวเก่าสุด ≤ วันเริ่ม) หรือหมดหน้า → หยุด; ไม่เลื่อนหน้าเกินช่วงต่อจากตัวเลื่อนไม่รู้จบด้วย
   * จำกัดรอบละ MAX_PAGES หน้า (กัน rate limit) แล้วให้ผู้ใช้กดโหลดต่อเอง; กดหยุดได้
   */
  const fromTs = advFromTs(adv);
  const oldest = useMemo(() => rows.reduce((m, r) => (wallet && r.walletId !== wallet ? m : Math.min(m, r.time)), Number.POSITIVE_INFINITY), [rows, wallet]);
  const covered = fromTs !== null && oldest <= fromTs;
  /* กันโดน 429: หน้าละใหญ่ (sol 100 แถว), ไม่ขอ metadata ระหว่างไล่, เว้น AUTO_GAP_MS ระหว่างหน้า,
     แหล่งที่เลื่อนหน้าด้วยเวลา (rabby: start_time) กระโดดไปวันสิ้นสุดของช่วงเลย ไม่ไล่ผ่านหน้าที่ใหม่กว่า,
     คิวคำขอกำลังพัก (โดน 429) → หยุด ไม่ยิงต่อ */
  const MAX_PAGES = 10;
  const AUTO_GAP_MS = 2500;
  const [auto, setAuto] = useState<{ key: string; pages: number; stopped: boolean; rate: number }>({ key: '', pages: 0, stopped: false, rate: 0 });
  const toTs = adv.date === 'custom' && adv.to ? Math.floor(new Date(adv.to.getFullYear(), adv.to.getMonth(), adv.to.getDate() + 1).getTime() / 1000) : null;
  const advKey = fromTs === null ? '' : `${wallet}|${fromTs}|${toTs}`;
  const run = auto.key === advKey ? auto : { key: advKey, pages: 0, stopped: false, rate: 0 };
  const want = fromTs !== null && !!onMore && hasMore && !covered && !run.stopped && !run.rate;
  const fetching = want && run.pages < MAX_PAGES;
  const lastRows = useRef(-1);
  useEffect(() => {
    if (!fetching || loading || lastRows.current === rows.length) return;
    const wait = pausedFor();
    if (wait > 0) {
      setAuto({ ...run, rate: Math.ceil(wait / 1000) });
      return;
    }
    const first = run.pages === 0;
    const t = setTimeout(
      () => {
        if (pausedFor() > 0) return setAuto({ ...run, rate: Math.ceil(pausedFor() / 1000) });
        lastRows.current = rows.length;
        setAuto({ ...run, pages: run.pages + 1 });
        // หน้าแรกของรอบ: กระโดดไปวันสิ้นสุดของช่วงถ้าแหล่งรองรับ และยังไม่ได้โหลดลงไปถึงตรงนั้น
        onMore?.({ count: bulk?.count, meta: false, seek: first && bulk?.seek && toTs !== null && oldest > toTs ? toTs : undefined });
      },
      first ? 0 : AUTO_GAP_MS,
    );
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetching, loading, rows.length]);
  const capped = want && run.pages >= MAX_PAGES;
  /* คิวคำขอพักอยู่ (429) ระหว่างไล่ → นับถอยหลังให้เห็น แทน "กำลังโหลด" ค้าง */
  const [pauseLeft, setPauseLeft] = useState(0);
  useEffect(() => {
    if (!fetching && !run.rate) return setPauseLeft(0);
    const tick = () => setPauseLeft(Math.ceil(pausedFor() / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [fetching, run.rate]);
  const rateLimited = fromTs !== null && !covered && (run.rate > 0 || (fetching && pauseLeft > 0));
  const fromLabel = fromTs === null ? '' : new Date(fromTs * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

  const inf = useInfinite({ total: filtered.length, page: PAGE, hasMore: hasMore && !covered, loading, fetchMore: onMore, resetKey: `${wallet}|${q}|${chain}|${type}|${JSON.stringify(conds)}|${sort.key}${sort.dir}|${JSON.stringify(adv)}` });
  const shown = filtered.slice(0, inf.visible);

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'type' ? 'asc' : 'desc' }));
  }

  const chainOpts = [
    { value: '', label: t('tx.allChains'), meta: scope.length },
    ...chains.map((c) => {
      const info = chainOf(chainInfo, c);
      return {
        value: c,
        label: (
          <span className="opt">
            <Logo src={info?.logo ?? null} name={info?.name ?? c} size={18} />
            {info?.name ?? c}
          </span>
        ),
        meta: scope.filter((r) => r.chain === c).length,
      };
    }),
  ];
  const typeOpts = [{ value: '' as TypeFilter, label: t('tx.allTypes'), meta: scope.length }, { value: 'transfer' as TypeFilter, label: t('tx.typeTransfer'), meta: countType('transfer') }, ...TYPES.map((k) => ({ value: k as TypeFilter, label: t(`tx.type.${k}`), meta: countType(k) }))];
  const chainName = (c: string) => chainOf(chainInfo, c)?.name ?? c;
  const typeName = (v: TxType | 'transfer') => (v === 'transfer' ? t('tx.typeTransfer') : t(`tx.type.${v}`));
  /* ชิปของกรวยหัวคอลัมน์ Type — แสดงรวมกับชิปของแผง Filters */
  const headChips: Array<[string, string, () => void]> = [
    ...conds.flatMap((c, i): Array<[string, string, () => void]> => (c.q.trim() ? [[`c${i}`, `${t('af.keyword')}: ${c.mode === 'exclude' ? `${t('af.exclude')} ` : ''}${c.q.trim()}`, () => setConds(conds.filter((_, j) => j !== i))]] : [])),
    ...(type ? [['type', `${t('tx.col.type')}: ${typeName(type)}`, () => setType('')] as [string, string, () => void]] : []),
    ...(chain ? [['chain', `${t('tx.col.chain')}: ${chainName(chain)}`, () => setChain('')] as [string, string, () => void]] : []),
  ];
  const headFilter = (k: SortKey, label: string) =>
    mobile ? null : k === 'type' ? (
      <HeadFilter<TypeHead> label={label} wide value={typeHead} onChange={setTypeHead} active={!!type || !!chain || liveConds(conds).length > 0} clear={() => ({ type: '', chain: '', conds: [] })} countFor={(d) => countFor(adv, d)}>
        {(d, set) => (
          <FieldGroup className="gap-4">
            <TokenConds list={d.conds} onChange={(conds) => set({ conds })} idp="txc" legend={t('af.keyword')} addLabel={t('af.addCond')} />
            <Field>
              <FieldLabel>{t('tx.col.type')}</FieldLabel>
              <Dropdown value={d.type} onChange={(type) => set({ type })} label={t('tx.col.type')} options={typeOpts} className="w-full" />
            </Field>
            {chains.length > 1 && (
              <Field>
                <FieldLabel>{t('tx.col.chain')}</FieldLabel>
                <Dropdown value={d.chain} onChange={(chain) => set({ chain })} label={t('tx.col.chain')} options={chainOpts} className="w-full" />
              </Field>
            )}
          </FieldGroup>
        )}
      </HeadFilter>
    ) : k === 'date' ? (
      <HeadFilter<AdvFilter> label={label} wide value={adv} onChange={setAdv} active={adv.date !== 'all'} clear={(d) => ({ ...d, date: 'all', from: undefined, to: undefined })} countFor={(d) => countFor(d)}>
        {(d, set) => <DateFields f={d} set={set} idp="txd" />}
      </HeadFilter>
    ) : null;

  const Head = ({ k, label, num }: { k: SortKey; label: string; num?: boolean }) => (
    <TableHead scope="col" className={num ? 'num' : undefined} aria-sort={sort.key === k ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <Button type="button" variant="ghost" size="sm" className="-ml-2.5 font-medium text-muted-foreground" onClick={() => toggleSort(k)}>
        {label}
        <Icon name={sort.key === k ? (sort.dir === 'asc' ? 'chevronUp' : 'chevronDown') : 'chevronsUpDown'} className="th-ico" />
      </Button>
      {headFilter(k, label)}
    </TableHead>
  );

  return (
    <>
      <div className="toolbar" role="search">
        {mobile && (
          <>
            <label className="sr-only" htmlFor="tx-q">
              {t('tx.search')}
            </label>
            <InputGroup className="max-w-sm">
              <InputGroupAddon>
                <SearchIcon />
              </InputGroupAddon>
              <InputGroupInput id="tx-q" name="q" type="search" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" spellCheck={false} />
            </InputGroup>
          </>
        )}
        <Dropdown value={wallet} onChange={onWallet} label={t('tx.col.wallet')} options={[{ value: '', label: t('tx.allWallets') }, ...wallets.map((w) => ({ value: w.id, label: w.label }))]} />
        {/* ค้นหา/เชน/ชนิด: มือถืออยู่บนแถบนี้; จอ ≥640 ย้ายเข้ากรวยของคอลัมน์ Type (ผู้ใช้ 2026-10-02) */}
        {mobile && <Dropdown value={chain} onChange={setChain} label={t('tx.col.chain')} options={chainOpts} />}
        {mobile && <Dropdown value={type} onChange={setType} label={t('tx.col.type')} options={typeOpts} />}
        <AdvancedFilterButton value={adv} onChange={setAdv} rows={scope} countFor={countFor} />
        <Field orientation="horizontal" className="w-auto">
          <Switch id="tx-hide-scam" checked={hideScam} onCheckedChange={(v) => setHideScam(v)} />
          <FieldLabel htmlFor="tx-hide-scam" className="font-normal">
            {t('tx.hideScam')}
          </FieldLabel>
        </Field>
        {/* ปุ่ม Reload ของกระเป๋า (เดิมอยู่ใน .headline ที่ถูกลบ) — แบบเดียวกับ Reload balance; มือถือเหลือไอคอนท้ายแถว */}
        {onReload && (
          <Button type="button" variant="ghost" disabled={loading} onClick={onReload} aria-label={t('tx.reload')} className="max-sm:ml-auto max-sm:size-8 max-sm:px-0">
            <RefreshCwIcon data-icon="inline-start" />
            <span className="max-sm:sr-only">{t('tx.reload')}</span>
          </Button>
        )}
        <span className="count" aria-live="polite">
          {t('tx.count', { n: filtered.length })}
        </span>
      </div>
      <AdvancedFilterChips
        value={adv}
        onChange={setAdv}
        extra={headChips}
        onClearExtra={() => setTypeHead({ type: '', chain: '', conds: [] })}
      />
      {(fetching || capped || rateLimited) && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
          {fetching && !rateLimited ? (
            <>
              <Spinner />
              {t('af.fetching', { date: fromLabel })}
              <Button variant="link" size="sm" onClick={() => setAuto({ ...run, stopped: true })}>
                {t('af.stop')}
              </Button>
            </>
          ) : rateLimited ? (
            <>
              {pauseLeft > 0 ? t('af.rate', { n: pauseLeft }) : t('af.rateReady')}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  lastRows.current = -1;
                  setAuto({ ...run, pages: 0, rate: 0 });
                }}
              >
                {t('af.continue')}
              </Button>
            </>
          ) : (
            <>
              {t('af.capped', { date: fromLabel })}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  lastRows.current = -1;
                  setAuto({ ...run, pages: 0, rate: 0 });
                }}
              >
                {t('af.continue')}
              </Button>
            </>
          )}
        </div>
      )}

      {filtered.length === 0 && !loading ? (
        <div className="empty">
          <p>{rows.length ? t('tx.emptyFiltered') : t('tx.emptyLoaded')}</p>
        </div>
      ) : (
        <div className="table-wrap">
          <Table containerClassName="overflow-visible" className="tx">
            <TableHeader ref={head.ref} data-stuck={head.stuck}>
              <TableRow>
                <Head k="type" label={t('tx.col.type')} />
                <Head k="date" label={t('tx.col.submitted')} num />
                <Head k="amount" label={t('tx.col.amount')} num />
                <Head k="fee" label={t('tx.col.fee')} num />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && loading && <SkeletonRows rows={8} cols={[140, 110, 120, 80]} />}
              {shown.map((r) => {
                const real = r.moves.filter((m) => m.amount !== 0);
                const ins = real.filter((m) => m.dir === 'in');
                const outs = real.filter((m) => m.dir === 'out');
                const isSwap = ins.length > 0 && outs.length > 0;
                const primary = mainMove(r);
                const chainLogo = chainOf(chainInfo, r.chain)?.logo ?? r.chainLogo ?? null;
                // เหรียญพื้นเมือง (ไม่มี tokenId) → ใช้โลโก้เชนแทน
                const logoOf = (m: { logo: string | null; tokenId: string | null }) => m.logo ?? (m.tokenId === null ? chainLogo : null);
                const title = r.failed ? t('tx.failed') : t(`tx.type.${r.type}`);
                const base = isSwap ? `${outs[0]!.symbol} → ${ins[0]!.symbol}` : primary ? (primary.name ?? primary.symbol) : r.name || (r.counterpartyName ?? '');
                // ชื่อโปรโตคอล/คู่สัญญาต่อท้าย (USDC · Lifiprotocol) — ถ้ามี
                const kind = protocolKind(r);
                const proto = r.counterpartyName ? (kind ? `${t(`kind.${kind}`)} · ${r.counterpartyName}` : r.counterpartyName) : '';
                const subtitle = proto && base !== r.counterpartyName ? (base ? `${base} · ${proto}` : proto) : base;
                const native = r.nativeSymbol ?? chainOf(chainInfo, r.chain)?.symbol ?? r.chain.toUpperCase();
                const symbols = [...new Set(real.map((m) => m.symbol))];
                const isSel = r.key === selected;
                return (
                  <TableRow
                    key={r.key}
                    className="tx-row"
                    tabIndex={0}
                    aria-selected={isSel}
                    onClick={() => onSelect(r)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelect(r);
                      }
                    }}
                  >
                    {/* มือถือเท่านั้น: max-w-0 + w-full ให้คอลัมน์ Type กินที่ที่เหลือแต่ไม่ดันตาราง → บรรทัดรองตัด … ได้
                        (ถ้าใช้ทุกจอ Type จะกว้างเต็มและดัน Submitted ไปชิดขวาบนเดสก์ท็อป) */}
                    <TableCell className="max-sm:w-full max-sm:max-w-0">
                      <span className="act">
                        <span className="act-icon">
                          {isSwap ? (
                            <span className="pair">
                              <Logo src={logoOf(outs[0]!)} name={outs[0]!.symbol} size={28} />
                              <Logo src={logoOf(ins[0]!)} name={ins[0]!.symbol} size={28} />
                            </span>
                          ) : (
                            <Logo src={primary ? logoOf(primary) : null} name={primary?.symbol ?? r.chain} size={40} />
                          )}
                          <span className="logo-badge">
                            <Logo src={chainLogo} name={r.chain} size={16} />
                          </span>
                        </span>
                        <span className="act-text">
                          <span className="act-title truncate">
                            {title}
                            {r.flagged && (
                              <span className="flag" title={t('tx.scam')}>
                                <Icon name="alert" width={12} height={12} style={{ verticalAlign: '-1px' }} />
                              </span>
                            )}
                          </span>
                          <span className="act-sub truncate" title={labels.get(r.walletId)}>
                            {onToken && symbols.length > 0 ? (
                              <>
                                {symbols.map((sym, i) => (
                                  <Fragment key={sym}>
                                    {i > 0 && ' · '}
                                    <button
                                      type="button"
                                      className="linkish"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onToken(sym);
                                      }}
                                    >
                                      {sym}
                                    </button>
                                  </Fragment>
                                ))}
                                {proto && ` · ${proto}`}
                              </>
                            ) : (
                              subtitle
                            )}
                          </span>
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="num cell-time">{formatRelative(r.time, t)}</TableCell>
                    <TableCell className="num">
                      <span className="amts">
                        {ins.map((m, i) => (
                          <span key={`i${i}`} className="amt-in">
                            +{formatAmount(m.amount)} {m.symbol}
                          </span>
                        ))}
                        {outs.map((m, i) => (
                          <span key={`o${i}`} className="amt-out">
                            {m.approve ? '' : '−'}
                            {formatAmount(m.amount)} {m.symbol}
                          </span>
                        ))}
                        {real.length === 0 && <span className="amt-out">—</span>}
                      </span>
                    </TableCell>
                    <TableCell className="num">
                      <span className="fee">
                        <span>{formatFeeUsd(r.gasUsd)}</span>
                        {r.gasNative !== null && <span className="amt-out">{formatFeeNative(r.gasNative, native)}</span>}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <MoreSentinel sentinel={inf.sentinel} loading={loading && shown.length > 0} exhausted={inf.exhausted} page={PAGE} count={filtered.length} />
        </div>
      )}
    </>
  );
}
