/** ยอดคงเหลือรายโทเคนของกระเป๋า (แท็บ Tokens เมื่อมีแหล่ง ERC-20) — คลิกแถวเพื่อไปหน้าโทเคนนั้น */
import { useMemo, useState } from 'react';
import type { BalanceState, BalanceRow } from '../balances';
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

type SortKey = 'token' | 'amount' | 'price' | 'value';

export function BalanceTable({ bal, chains, onToken }: { bal: BalanceState; chains: ChainMap; onToken: (symbol: string) => void }) {
  const { t } = useI18n();
  const { settings, setHideScam } = useStore();
  const hideScam = settings.hideScam;
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'value', dir: -1 });
  const head = useStickyHead();
  const all = bal.data?.rows ?? [];
  const rows = useMemo(() => {
    const val = (r: BalanceRow) => (sort.key === 'token' ? r.symbol.toLowerCase() : sort.key === 'amount' ? r.amount : sort.key === 'price' ? (r.price ?? -1) : (r.usd ?? -1));
    return (hideScam ? all.filter((r) => r.verified) : all).slice().sort((a, b) => {
      const x = val(a);
      const y = val(b);
      return (x > y ? 1 : x < y ? -1 : 0) * sort.dir;
    });
  }, [all, hideScam, sort]);
  const total = rows.reduce((s, r) => s + (r.usd ?? 0), 0);
  const wait = Math.ceil(pausedFor() / 1000);

  const Th = ({ k, label, num }: { k: SortKey; label: string; num?: boolean }) => (
    <TableHead scope="col" className={num ? 'num' : undefined} aria-sort={sort.key === k ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <Button type="button" variant="ghost" size="sm" className="-ml-2.5 font-medium text-muted-foreground" onClick={() => setSort((s) => (s.key === k ? { key: k, dir: s.dir === 1 ? -1 : 1 } : { key: k, dir: k === 'token' ? 1 : -1 }))}>
        {label}
        <Icon name={sort.key === k ? (sort.dir === 1 ? 'chevronUp' : 'chevronDown') : 'chevronsUpDown'} className="th-ico" />
      </Button>
    </TableHead>
  );

  return (
    <>
      <div className="toolbar">
        <Field orientation="horizontal" className="w-auto">
          <Switch id="bal-hide-scam" checked={hideScam} onCheckedChange={(v) => setHideScam(v)} />
          <FieldLabel htmlFor="bal-hide-scam" className="font-normal">
            {t('tx.hideScam')}
          </FieldLabel>
        </Field>
        <Button type="button" variant="ghost" size="sm" disabled={bal.loading} onClick={bal.reload}>
          <RefreshCwIcon data-icon="inline-start" />
          {t('bal.reload')}
        </Button>
        <span className="count" aria-live="polite">
          {t('token.count', { n: rows.length })} · {t('bal.total')} {formatUsdExact(total)}
        </span>
      </div>
      {(bal.data?.limited || bal.error) && (
        <Alert>
          <AlertDescription>{bal.error ? t('bal.error') : wait > 0 ? t('bal.partialWait', { s: wait }) : t('bal.partial')}</AlertDescription>
        </Alert>
      )}
      {!bal.loading && rows.length === 0 && bal.data ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t('bal.empty')}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="table-wrap">
          <Table containerClassName="lg:overflow-visible" className="tx bal">
            <TableHeader ref={head.ref} data-stuck={head.stuck}>
              <TableRow>
                <Th k="token" label={t('tab.tokens')} />
                <Th k="amount" label={t('bal.col.amount')} num />
                <Th k="price" label={t('bal.col.price')} num />
                <Th k="value" label={t('bal.col.value')} num />
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
                    onClick={() => onToken(r.symbol)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onToken(r.symbol);
                      }
                    }}
                  >
                    <TableCell className="max-sm:w-full max-sm:max-w-0">
                      <span className="who">
                        <TokenLogo token={r.logo} tokenName={r.symbol} chain={chain?.logo ?? null} chainName={chain?.name ?? r.chain} size={28} />
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
