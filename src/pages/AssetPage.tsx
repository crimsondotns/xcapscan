/**
 * หน้าโทเคนหนึ่งตัว — ประวัติเฉพาะโทเคนนั้น ดูได้ทั้งแบบทุกกระเป๋าและเฉพาะกระเป๋าที่เข้ามา
 * ข้อมูลมาจากธุรกรรมที่โหลดไว้แล้วเท่านั้น ไม่มีการยิงคำขอเพิ่มของหน้านี้เอง
 */
import { useMemo, useState } from 'react';
import type { TxRow } from '../feed';
import type { ChainMap } from '../chains';
import type { Wallet } from '../store';
import type { GroupId } from '../groups';
import { lastTime, netUsd, rowsOfToken, signClassOf, tokenSummary, totals, withinDays } from '../flow';
import { formatAmount, formatPrice, formatRelative, formatUsdExact, shortAddr } from '../format';
import { useI18n } from '../i18n';
import { useCopy } from '../copy';
import { FlowChart, RangeChips, Stat, type Range } from '../components/FlowChart';
import { useGroupLabel } from '../components/GroupNav';
import { PageTabs } from '../components/PageTabs';
import { TxTable } from '../components/TxTable';
import { TokenLogo } from '../components/Logo';
import { Identicon } from '../components/Identicon';
import { SkeletonRows } from '../components/Skeleton';
import { Icon } from '../components/Icon';
import { chainOf } from '../chains';
import { priceOf } from '../prices';
import { useStickyHead } from '../useStickyHead';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

export function AssetPage({ symbol, wallet, all, rows, chains, group, range, onRange, onBack, onBackWallet, onWallet, onScopeAll, selected, onSelect, loading }: { symbol: string; wallet: Wallet | null; all: Wallet[]; rows: TxRow[]; chains: ChainMap; group: GroupId; range: Range; onRange: (r: Range) => void; onBack: () => void; onBackWallet: () => void; onWallet: (id: string) => void; onScopeAll: () => void; selected: string | null; onSelect: (r: TxRow) => void; loading: boolean }) {
  const { t } = useI18n();
  const copy = useCopy();
  const [tab, setTab] = useState<'history' | 'holders'>('history');
  const holdersHead = useStickyHead();
  const groupLabel = useGroupLabel(all, group);
  const list = useMemo(() => rowsOfToken(rows, symbol), [rows, symbol]);
  const ranged = useMemo(() => withinDays(list, range), [list, range]);
  const token = useMemo(() => tokenSummary(ranged).find((k) => k.symbol === symbol) ?? tokenSummary(list).find((k) => k.symbol === symbol) ?? null, [ranged, list, symbol]);
  const sums = useMemo(() => totals(ranged), [ranged]);
  const pending = loading && rows.length === 0;
  const chain = token ? chainOf(chains, token.chain) : undefined;
  const price = token ? priceOf(token.chain, token.tokenId, token.symbol) : null;
  const holders = useMemo(() => {
    const ids = [...new Set(ranged.map((r) => r.walletId))];
    return ids.map((id) => {
      const sub = ranged.filter((r) => r.walletId === id);
      return { id, wallet: all.find((w) => w.id === id) ?? null, count: sub.length, net: sub.reduce((s, r) => s + netUsd(r), 0), last: lastTime(sub) };
    }).sort((a, b) => b.count - a.count);
  }, [ranged, all]);

  return (
    <>
      <Breadcrumb aria-label={t('nav.back')}>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<button type="button" onClick={onBack} />}>{groupLabel}</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          {wallet && (
            <>
              <BreadcrumbItem>
                <BreadcrumbLink render={<button type="button" onClick={onBackWallet} />}>{wallet.label}</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
            </>
          )}
          <BreadcrumbItem>
            <BreadcrumbPage>{symbol}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <section className="panel">
        <div className="headline">
          <span className="who">
            <TokenLogo token={token?.logo ?? null} tokenName={symbol} chain={chain?.logo ?? null} chainName={chain?.name ?? token?.chain ?? ''} size={44} />
            <span className="act-text">
              {token?.tokenId ? (
                <button type="button" className="act-title head-name copy-name" title={t('token.copyAddress', { sym: symbol })} aria-label={t('token.copyAddress', { sym: symbol })} onClick={() => copy(token.tokenId ?? '')}>
                  {symbol}
                </button>
              ) : (
                <span className="act-title head-name" title={t('token.native')}>
                  {symbol}
                </span>
              )}
              <span className="act-sub">
                {token?.flagged && (
                  <span className="flag" title={t('tx.scam')}>
                    <Icon name="alert" width={12} height={12} style={{ verticalAlign: '-1px' }} />
                  </span>
                )}
                {[token?.name ?? null, chain?.name ?? token?.chain ?? null, price === null ? null : t('token.perUnit', { price: formatPrice(price) })].filter(Boolean).join(' · ')}
              </span>
            </span>
          </span>
          <span className="top-spacer" />
          {wallet && (
            <ToggleGroup variant="outline" size="sm" value={['wallet']} onValueChange={(v: string[]) => v[0] === 'all' && onScopeAll()} aria-label={t('token.scopeLabel')}>
              <ToggleGroupItem value="wallet">{t('token.scopeWallet', { label: wallet.label })}</ToggleGroupItem>
              <ToggleGroupItem value="all">{t('token.scopeAll')}</ToggleGroupItem>
            </ToggleGroup>
          )}
          <RangeChips value={range} onChange={onRange} />
        </div>
        <div className="stat-row">
          <Stat label={t('token.received')} value={`${formatAmount(token?.inAmount ?? 0)} ${symbol}`} tone="is-pos" sub={formatUsdExact(token?.inUsd ?? 0)} loading={pending} />
          <Stat label={t('token.sent')} value={`${formatAmount(token?.outAmount ?? 0)} ${symbol}`} tone="is-neg" sub={formatUsdExact(token?.outUsd ?? 0)} loading={pending} />
          <Stat label={t('token.net')} value={formatUsdExact((token?.inUsd ?? 0) - (token?.outUsd ?? 0))} tone={signClassOf((token?.inUsd ?? 0) - (token?.outUsd ?? 0))} sub={`${formatAmount((token?.inAmount ?? 0) - (token?.outAmount ?? 0))} ${symbol}`} loading={pending} />
          <Stat label={t('token.holders')} value={String(holders.length)} sub={t('flow.net', { n: range, tx: sums.count })} loading={pending} />
        </div>
        <FlowChart rows={ranged} days={range} height={200} loading={pending} />
        <PageTabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'history', label: t('token.history', { sym: symbol }), count: list.length },
            { value: 'holders', label: t('tab.holders'), count: holders.length },
          ]}
        />
        {tab === 'history' ? (
          <TxTable rows={list} wallets={all} chains={chains} wallet={wallet?.id ?? ''} onWallet={(id) => (id ? onWallet(id) : onScopeAll())} selected={selected} onSelect={onSelect} loading={loading} />
        ) : (
          <div className="table-wrap">
            <Table containerClassName="lg:overflow-visible" className="tx">
              <TableHeader ref={holdersHead.ref} data-stuck={holdersHead.stuck}>
                <TableRow>
                  <TableHead scope="col">{t('tx.col.wallet')}</TableHead>
                  <TableHead scope="col" className="num">
                    {t('token.times')}
                  </TableHead>
                  <TableHead scope="col" className="num">
                    {t('token.net')}
                  </TableHead>
                  <TableHead scope="col" className="num">
                    {t('wallets.col.last')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {holders.length === 0 && loading && <SkeletonRows rows={4} cols={[160, 60, 90, 90]} />}
                {holders.map((h) => (
                  <TableRow
                    key={h.id}
                    className="tx-row"
                    tabIndex={0}
                    onClick={() => onWallet(h.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onWallet(h.id);
                      }
                    }}
                  >
                    <TableCell>
                      <span className="who">
                        <Identicon value={h.wallet?.address ?? h.id} size={28} />
                        <span className="act-text">
                          <span className="act-title">{h.wallet?.label ?? shortAddr(h.id)}</span>
                          <span className="act-sub mono">{shortAddr(h.wallet?.address ?? h.id)}</span>
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="num">{h.count}</TableCell>
                    <TableCell className="num">
                      <span className={signClassOf(h.net)}>{formatUsdExact(h.net)}</span>
                    </TableCell>
                    <TableCell className="num cell-time">{h.last === null ? '—' : formatRelative(h.last, t)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </>
  );
}
