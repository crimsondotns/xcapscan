/** สรุปรายโทเคนของกระเป๋า — คลิกแถวเพื่อไปหน้าโทเคนนั้น */
import { useMemo } from 'react';
import type { TxRow } from '../feed';
import { tokenSummary, signClassOf } from '../flow';
import { formatUsdExact } from '../format';
import { useI18n } from '../i18n';
import { useCopy } from '../copy';
import { TokenLogo } from './Logo';
import { chainOf, type ChainMap } from '../chains';
import { Icon } from './Icon';
import { useStickyHead } from '../useStickyHead';
import { SkeletonRows } from './Skeleton';
import { useStore } from '../store';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Field, FieldLabel } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';

export function TokenTable({ rows, chains, onToken, loading = false }: { rows: TxRow[]; chains: ChainMap; onToken: (symbol: string) => void; loading?: boolean }) {
  const { t } = useI18n();
  const copy = useCopy();
  /* ซ่อน/แสดงโทเคนน่าสงสัย — ใช้ค่าเดียวกับแท็บธุรกรรม (settings.hideScam) */
  const { settings, setHideScam } = useStore();
  const hideScam = settings.hideScam;
  const all = useMemo(() => tokenSummary(rows), [rows]);
  /* โลโก้เชน: chain list ก่อน แล้วค่อยโลโก้ที่แหล่งข้อมูลแนบมากับแถว — ไม่มีทั้งคู่ = ตัวอักษร */
  const feedChainLogo = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) if (r.chainLogo && !m.has(r.chain)) m.set(r.chain, r.chainLogo);
    return m;
  }, [rows]);
  const tokens = useMemo(() => (hideScam ? all.filter((k) => !k.flagged) : all), [all, hideScam]);
  const head = useStickyHead();
  if (!all.length && !loading) return <p className="text-sm text-muted-foreground">{t('tx.emptyLoaded')}</p>;
  return (
    <>
      <div className="toolbar">
        <Field orientation="horizontal" className="w-auto">
          <Switch id="token-hide-scam" checked={hideScam} onCheckedChange={(v) => setHideScam(v)} />
          <FieldLabel htmlFor="token-hide-scam" className="font-normal">
            {t('tx.hideScam')}
          </FieldLabel>
        </Field>
        <span className="count" aria-live="polite">
          {t('token.count', { n: tokens.length })}
        </span>
      </div>
      {tokens.length === 0 && !loading ? (
        <div className="empty">
          <p>{t('tx.emptyFiltered')}</p>
        </div>
      ) : (
        <div className="table-wrap">
          <Table containerClassName="max-sm:overflow-visible lg:overflow-visible" className="tx">
            <TableHeader ref={head.ref} data-stuck={head.stuck}>
              <TableRow>
                <TableHead scope="col">{t('tab.tokens')}</TableHead>
                <TableHead scope="col" className="num">
                  {t('flow.in')}
                </TableHead>
                <TableHead scope="col" className="num">
                  {t('flow.out')}
                </TableHead>
                <TableHead scope="col" className="num">
                  {t('token.net')}
                </TableHead>
                <TableHead scope="col" className="num">
                  {t('token.times')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokens.length === 0 && loading && <SkeletonRows rows={5} cols={[150, 90, 90, 90, 50]} />}
              {tokens.map((k) => (
                <TableRow
                  key={k.symbol}
                  className="tx-row"
                  tabIndex={0}
                  onClick={() => onToken(k.symbol)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onToken(k.symbol);
                    }
                  }}
                >
                  <TableCell>
                    <span className="who">
                      <TokenLogo token={k.logo} tokenName={k.symbol} chain={chainOf(chains, k.chain)?.logo ?? feedChainLogo.get(k.chain) ?? null} chainName={chainOf(chains, k.chain)?.name ?? k.chain} size={28} />
                      <span className="act-text">
                        {k.tokenId ? (
                          <button
                            type="button"
                            className="act-title copy-name"
                            title={t('token.copyAddress', { sym: k.symbol })}
                            aria-label={t('token.copyAddress', { sym: k.symbol })}
                            onClick={(e) => {
                              e.stopPropagation();
                              copy(k.tokenId ?? '');
                            }}
                          >
                            {k.symbol}
                          </button>
                        ) : (
                          <span className="act-title" title={t('token.native')}>
                            {k.symbol}
                          </span>
                        )}
                        <span className="act-sub">
                          {k.flagged && (
                            <span className="flag" title={t('tx.scam')}>
                              <Icon name="alert" width={12} height={12} style={{ verticalAlign: '-1px' }} />
                            </span>
                          )}
                          {k.name ?? k.chain}
                        </span>
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="num">{formatUsdExact(k.inUsd)}</TableCell>
                  <TableCell className="num">{formatUsdExact(k.outUsd)}</TableCell>
                  <TableCell className="num">
                    <span className={signClassOf(k.inUsd - k.outUsd)}>{formatUsdExact(k.inUsd - k.outUsd)}</span>
                  </TableCell>
                  <TableCell className="num">{k.count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
