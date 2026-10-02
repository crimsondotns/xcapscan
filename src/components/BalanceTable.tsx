/** ยอดคงเหลือรายโทเคนของกระเป๋า (แท็บ Tokens เมื่อมีแหล่งตระกูลเดียวกับกระเป๋า) — คลิกแถวเพื่อไปหน้าโทเคนนั้น */
import { useMemo, useState } from 'react';
import { type BalanceState, type BalanceRow } from '../balances';
import { formatAmount, formatPrice, formatUsdExact } from '../format';
import { useI18n } from '../i18n';
import { useStore } from '../store';
import { chainOf, type ChainMap } from '../chains';
import { pausedFor } from '../limiter';
import { TokenLogo } from './Logo';
import { Icon } from './Icon';
import { SkeletonRows } from './Skeleton';
import { useStickyHead } from '../useStickyHead';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Field, FieldLabel } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Empty, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { RefreshCwIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/useIsMobile';
import { BAL_EMPTY, BalanceFilterButton, ColumnFilter, BalanceFilterChips, passBal, type BalFilter } from './BalanceFilter';
import { Logo } from './Logo';

type SortKey = 'token' | 'amount' | 'price' | 'value';

export function BalanceTable({ bal, chains, onToken }: { bal: BalanceState; chains: ChainMap; onToken: (tokenKey: string) => void }) {
  const { t } = useI18n();
  const { settings, setHideScam } = useStore();
  const hideScam = settings.hideScam;
  /* ปุ่ม Filters: เชน + ช่วงมูลค่า USD (ผู้ใช้ 2026-10-02) */
  const [bf, setBf] = useState<BalFilter>(BAL_EMPTY);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'value', dir: -1 });
  const head = useStickyHead();
  const mobile = useIsMobile();
  const all = bal.data?.rows ?? [];
  const rows = useMemo(() => {
    const val = (r: BalanceRow) => (sort.key === 'token' ? r.symbol.toLowerCase() : sort.key === 'amount' ? r.amount : sort.key === 'price' ? (r.price ?? -1) : (r.usd ?? -1));
    return all.filter((r) => (!hideScam || r.verified) && passBal(r, bf)).sort((a, b) => {
      const x = val(a);
      const y = val(b);
      return (x > y ? 1 : x < y ? -1 : 0) * sort.dir;
    });
  }, [all, hideScam, sort, bf]);
  /* เชนที่มีในยอด + จำนวนโทเคน — ตัวเลือกของ dropdown */
  const chainOpts = useMemo(() => {
    const n = new Map<string, number>();
    for (const r of all) n.set(r.chain, (n.get(r.chain) ?? 0) + 1);
    return [
      { value: '', label: t('bal.allChains'), meta: all.length },
      ...[...n].map(([id, count]) => {
        const c = chainOf(chains, id);
        return {
          value: id,
          label: (
            <span className="opt">
              <Logo src={c?.logo ?? null} name={c?.name ?? id} size={18} />
              {c?.name ?? id}
            </span>
          ),
          meta: count,
        };
      }),
    ];
  }, [all, chains, t]);
  const total = rows.reduce((s, r) => s + (r.usd ?? 0), 0);
  const wait = Math.ceil(pausedFor() / 1000);

  const countFor = (f: BalFilter) => all.filter((r) => (!hideScam || r.verified) && passBal(r, f)).length;
  /* Token กินที่เหลือ · ตัวเลข 3 คอลัมน์กว้างเท่ากัน 18% (ผู้ใช้ 2026-10-02) */
  const Th = ({ k, label, num, filter }: { k: SortKey; label: string; num?: boolean; filter?: 'chain' | 'usd' }) => (
    <TableHead scope="col" className={cn(num && 'num sm:w-[18%]')} aria-sort={sort.key === k ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <Button type="button" variant="ghost" size="sm" className="-ml-2.5 font-medium text-muted-foreground" onClick={() => setSort((s) => (s.key === k ? { key: k, dir: s.dir === 1 ? -1 : 1 } : { key: k, dir: k === 'token' ? 1 : -1 }))}>
        {label}
        <Icon name={sort.key === k ? (sort.dir === 1 ? 'chevronUp' : 'chevronDown') : 'chevronsUpDown'} className="th-ico" />
      </Button>
      {filter && !mobile && <ColumnFilter field={filter} label={filter === 'chain' ? label : `${label} (USD)`} value={bf} onChange={setBf} chains={chainOpts} countFor={countFor} />}
    </TableHead>
  );

  return (
    <>
      <div className="toolbar">
        {/* ปุ่ม Filters เฉพาะมือถือ — จอกว้างกรองจากหัวคอลัมน์ (ผู้ใช้ 2026-10-02) */}
        {mobile && <BalanceFilterButton value={bf} onChange={setBf} chains={chainOpts} countFor={countFor} />}
        <Field orientation="horizontal" className="w-auto">
          <Switch id="bal-hide-scam" checked={hideScam} onCheckedChange={(v) => setHideScam(v)} />
          <FieldLabel htmlFor="bal-hide-scam" className="font-normal">
            {t('tx.hideScam')}
          </FieldLabel>
        </Field>
        {/* มือถือ: ไอคอนอย่างเดียวท้ายแถวเดียวกับ Filters (ไม่ขึ้นบรรทัดเอง) */}
        <Button type="button" variant="ghost" disabled={bal.loading} onClick={bal.reload} aria-label={t('bal.reload')} className="max-sm:ml-auto max-sm:size-8 max-sm:px-0">
          <RefreshCwIcon data-icon="inline-start" />
          <span className="max-sm:sr-only">{t('bal.reload')}</span>
        </Button>
        <span className="count" aria-live="polite">
          {t('token.count', { n: rows.length })} · {t('bal.total')} {formatUsdExact(total)}
        </span>
      </div>
      <BalanceFilterChips value={bf} onChange={setBf} chainLabel={(id) => chainOpts.find((o) => o.value === id)?.label ?? id} />
      {(bal.data?.limited || bal.error) && (
        <Alert>
          <AlertDescription>{bal.error ? t('bal.error') : wait > 0 ? t('bal.partialWait', { s: wait }) : t('bal.partial')}</AlertDescription>
        </Alert>
      )}
      {!bal.loading && rows.length === 0 && bal.data ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{all.length ? t('tx.emptyFiltered') : t('bal.empty')}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="table-wrap">
          <Table containerClassName="lg:overflow-visible" className="tx bal">
            <TableHeader ref={head.ref} data-stuck={head.stuck}>
              <TableRow>
                <Th k="token" label={t('tab.tokens')} filter="chain" />
                <Th k="amount" label={t('bal.col.amount')} num />
                <Th k="price" label={t('bal.col.price')} num />
                <Th k="value" label={t('bal.col.value')} num filter="usd" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {bal.loading && rows.length === 0 && <SkeletonRows rows={5} cols={[150, 90, 90, 90]} />}
              {rows.map((r) => {
                const chain = chainOf(chains, r.chain);
                return (
                  <TableRow
                    key={`${r.chain}:${r.tokenId}`}
                    className="tx-row"
                    tabIndex={0}
                    onClick={() => onToken(r.tokenId)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onToken(r.tokenId);
                      }
                    }}
                  >
                    {/* กินที่เหลือ (มือถือตัด …); โลโก้ 40px = แถวสูงเท่า TxTable (ผู้ใช้ 2026-10-02) */}
                    <TableCell className="max-sm:w-full max-sm:max-w-0">
                      <span className="who">
                        <TokenLogo token={r.logo} tokenName={r.symbol} chain={chain?.logo ?? null} chainName={chain?.name ?? r.chain} size={40} />
                        <span className="act-text min-w-0">
                          <span className="act-title truncate">
                            {r.symbol}
                            {!r.verified && (
                              <span className="flag" title={t('tx.scam')}>
                                <Icon name="alert" width={12} height={12} style={{ verticalAlign: '-1px' }} />
                              </span>
                            )}
                          </span>
                          <span className="act-sub truncate">{chain?.name ?? r.chain}</span>
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="num">{formatAmount(r.amount)}</TableCell>
                    <TableCell className="num">{formatPrice(r.price)}</TableCell>
                    <TableCell className="num">
                      <span className="amts">
                        <span>{r.usd !== null ? formatUsdExact(r.usd) : '—'}</span>
                        {/* มือถือ: คอลัมน์ Amount ถูกซ่อน → จำนวนเป็นบรรทัดรองใต้มูลค่า */}
                        <span className="amt-out sm:hidden">{formatAmount(r.amount)}</span>
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
