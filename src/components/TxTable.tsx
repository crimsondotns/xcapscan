import { Fragment, useMemo, useState } from 'react';
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
import { Field, FieldLabel } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { SearchIcon } from 'lucide-react';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';

const TYPES: TxType[] = ['swap', 'send', 'receive', 'approve', 'contract'];
/** ตัวกรองชนิด: 'transfer' = โอน นับทั้งส่งและรับในอันเดียว ('' = ทุกประเภท) */
type TypeFilter = '' | 'transfer' | TxType;
const matchesType = (r: TxRow, f: TypeFilter): boolean => (f === '' ? true : f === 'transfer' ? r.type === 'send' || r.type === 'receive' : r.type === f);
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

export function TxTable({ rows, wallets, chains: chainInfo, wallet, onWallet, onToken, selected, onSelect, loading = false, hasMore = false, onMore }: { rows: TxRow[]; wallets: Wallet[]; chains: ChainMap; wallet: string; onWallet: (id: string) => void; onToken?: (symbol: string) => void; selected: string | null; onSelect: (r: TxRow) => void; loading?: boolean; hasMore?: boolean; onMore?: () => void }) {
  const { t } = useI18n();
  const { settings, setHideScam } = useStore();
  const hideScam = settings.hideScam;
  const [q, setQ] = useState('');
  const [chain, setChain] = useState('');
  const [type, setType] = useState<TypeFilter>('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' });

  const labels = useMemo(() => new Map(wallets.map((w) => [w.id, w.label])), [wallets]);
  const chains = useMemo(() => [...new Set(rows.map((r) => r.chain))].sort(), [rows]);
  /* จำนวนของแต่ละตัวเลือกในแผง — นับจากแถวทั้งหมดของหน้านี้ ไม่ใช่หลังกรอง (ไม่งั้นทุกตัวเลือกอื่นเป็น 0) */
  const scope = useMemo(() => (wallet ? rows.filter((r) => r.walletId === wallet) : rows), [rows, wallet]);
  const countType = (f: TypeFilter) => scope.filter((r) => matchesType(r, f)).length;

  const PAGE = 25;
  const head = useStickyHead();
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (wallet && r.walletId !== wallet) return false;
      if (chain && r.chain !== chain) return false;
      if (!matchesType(r, type)) return false;
      if (hideScam && r.flagged) return false;
      if (!needle) return true;
      return r.hash.toLowerCase().includes(needle) || (r.counterparty ?? '').toLowerCase().includes(needle) || (r.counterpartyName ?? '').toLowerCase().includes(needle) || r.name.toLowerCase().includes(needle) || r.moves.some((m) => m.symbol.toLowerCase().includes(needle));
    });
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
  }, [rows, q, wallet, chain, type, sort, labels, hideScam]);
  const inf = useInfinite({ total: filtered.length, page: PAGE, hasMore, loading, fetchMore: onMore, resetKey: `${wallet}|${q}|${chain}|${type}|${sort.key}${sort.dir}` });
  const shown = filtered.slice(0, inf.visible);

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'type' ? 'asc' : 'desc' }));
  }

  const Head = ({ k, label, num }: { k: SortKey; label: string; num?: boolean }) => (
    <TableHead scope="col" className={num ? 'num' : undefined} aria-sort={sort.key === k ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <Button type="button" variant="ghost" size="sm" className="-ml-2.5 font-medium text-muted-foreground" onClick={() => toggleSort(k)}>
        {label}
        <Icon name={sort.key === k ? (sort.dir === 'asc' ? 'chevronUp' : 'chevronDown') : 'chevronsUpDown'} className="th-ico" />
      </Button>
    </TableHead>
  );

  return (
    <>
      <div className="toolbar" role="search">
        <label className="sr-only" htmlFor="tx-q">
          {t('tx.search')}
        </label>
        <InputGroup className="max-w-sm">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput id="tx-q" name="q" type="search" placeholder={t('tx.search')} value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" spellCheck={false} />
        </InputGroup>
        <Dropdown value={wallet} onChange={onWallet} label={t('tx.col.wallet')} options={[{ value: '', label: t('tx.allWallets') }, ...wallets.map((w) => ({ value: w.id, label: w.label }))]} />
        <Dropdown
          value={chain}
          onChange={setChain}
          label={t('tx.col.chain')}
          options={[
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
          ]}
        />
        <Dropdown value={type} onChange={setType} label={t('tx.col.type')} options={[{ value: '' as TypeFilter, label: t('tx.allTypes'), meta: scope.length }, { value: 'transfer' as TypeFilter, label: t('tx.typeTransfer'), meta: countType('transfer') }, ...TYPES.map((k) => ({ value: k as TypeFilter, label: t(`tx.type.${k}`), meta: countType(k) }))]} />
        <Field orientation="horizontal" className="w-auto">
          <Switch id="tx-hide-scam" checked={hideScam} onCheckedChange={(v) => setHideScam(v)} />
          <FieldLabel htmlFor="tx-hide-scam" className="font-normal">
            {t('tx.hideScam')}
          </FieldLabel>
        </Field>
        <span className="count" aria-live="polite">
          {t('tx.count', { n: filtered.length })}
        </span>
      </div>

      {filtered.length === 0 && !loading ? (
        <div className="empty">
          <p>{rows.length ? t('tx.emptyFiltered') : t('tx.emptyLoaded')}</p>
        </div>
      ) : (
        <div className="table-wrap">
          <Table containerClassName="lg:overflow-visible" className="tx">
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
                    <TableCell>
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
                          <span className="act-title">
                            {title}
                            {r.flagged && (
                              <span className="flag" title={t('tx.scam')}>
                                <Icon name="alert" width={12} height={12} style={{ verticalAlign: '-1px' }} />
                              </span>
                            )}
                          </span>
                          <span className="act-sub" title={labels.get(r.walletId)}>
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
