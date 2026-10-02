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
import type { Range } from '../components/FlowChart';
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
import { Button } from '@/components/ui/button';
import { CopyIcon, GlobeIcon } from 'lucide-react';
import { useBalances } from '../balances';
import { useTokenHistory } from '../tokenFeed';
import { useStore } from '../store';

/** หน้าโทเคนแบบทุกกระเป๋า — ไม่มีกระเป๋าให้ดูยอด (ตระกูล sol = ไม่ยิงคำขอ) */
const NO_WALLET = { id: '', label: '', address: '', family: 'sol', enabled: true } as unknown as Wallet;

export function AssetPage({ tokenKey, wallet, all, rows, chains, group, range, onRange, onBack, onBackWallet, onWallet, onScopeAll, selected, onSelect, loading }: { tokenKey: string; wallet: Wallet | null; all: Wallet[]; rows: TxRow[]; chains: ChainMap; group: GroupId; range: Range; onRange: (r: Range) => void; onBack: () => void; onBackWallet: () => void; onWallet: (id: string) => void; onScopeAll: () => void; selected: string | null; onSelect: (r: TxRow) => void; loading: boolean }) {
  const { t } = useI18n();
  const copy = useCopy();
  const [tab, setTab] = useState<'history' | 'holders'>('history');
  const holdersHead = useStickyHead();
  const groupLabel = useGroupLabel(all, group);
  const { settings } = useStore();
  /* ยอดคงเหลือของกระเป๋านี้ — ได้จากแคชถ้าเคยเปิดแท็บ Tokens; ไม่มีกระเป๋า = ไม่ยิง */
  const bal = useBalances(wallet ?? NO_WALLET, settings.endpoints, !!wallet);
  /* path พก token address (ผู้ใช้ 2026-10-02) หรือ symbol (ลิงก์เก่า/จากชื่อในตาราง) — หา symbol + เชนจากยอด แล้วจากประวัติ */
  const k = tokenKey.toLowerCase();
  const balHit = bal.data?.rows.find((r) => r.tokenId.toLowerCase() === k) ?? null;
  const histHit = useMemo(() => {
    for (const r of rows) for (const m of r.moves) if (m.tokenId && m.tokenId.toLowerCase() === k) return { chain: r.chain, symbol: m.symbol };
    return null;
  }, [rows, k]);
  const byId = !!(balHit || histHit);
  const symbol = balHit?.symbol ?? histHit?.symbol ?? tokenKey;
  const tokenChain = balHit?.chain ?? histHit?.chain ?? null;
  /* ประวัติของโทเคนนี้จากแหล่งโดยตรง (chain_id + token_id) — เร็วกว่าไล่ทั้งกระเป๋า; ไม่ได้ก็กรองจากที่โหลดไว้ */
  const th = useTokenHistory(wallet, settings.endpoints, tokenChain, byId ? tokenKey : null, settings.pageSize);
  const local = useMemo(() => (byId ? rows.filter((r) => r.moves.some((m) => m.amount !== 0 && m.tokenId?.toLowerCase() === k)) : rowsOfToken(rows, symbol)), [rows, byId, k, symbol]);
  const list = useMemo(() => {
    if (!th.supported) return local;
    const seen = new Set(th.rows.map((r) => r.key));
    return [...th.rows, ...local.filter((r) => !seen.has(r.key))].sort((a, b) => b.time - a.time);
  }, [th.supported, th.rows, local]);
  const ranged = useMemo(() => withinDays(list, range), [list, range]);
  const token = useMemo(() => tokenSummary(ranged).find((x) => x.symbol === symbol) ?? tokenSummary(list).find((x) => x.symbol === symbol) ?? null, [ranged, list, symbol]);
  const sums = useMemo(() => totals(ranged), [ranged]);
  const pending = (th.supported ? th.loading : loading) && list.length === 0;
  const mine = useMemo(() => (wallet && bal.data ? bal.data.rows.filter((r) => (byId ? r.tokenId.toLowerCase() === k : r.symbol === symbol)) : []), [wallet, bal.data, byId, k, symbol]);
  const top = mine[0] ?? null;
  const mineTotal = mine.reduce((n, r) => n + r.amount, 0);
  const mineUsd = mine.some((r) => r.usd !== null) ? mine.reduce((n, r) => n + (r.usd ?? 0), 0) : null;
  const topAddr = !!top && /^0x[0-9a-f]{40}$/i.test(top.tokenId);
  const topHost = top ? chainOf(chains, top.chain)?.explorer?.replace(/\/+$/, '') : undefined;
  const chain = chainOf(chains, token?.chain ?? top?.chain ?? tokenChain ?? '') ?? undefined;
  const price = top?.price ?? (token ? priceOf(token.chain, token.tokenId, token.symbol) : null);
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
        {wallet && bal.supported && (mine.length > 0 || bal.loading) && (
          /* การ์ด My balance แบบ A (ผู้ใช้ 2026-10-02): ตัวเลขใหญ่ + ≈ USD; ปุ่มคัดลอก/explorer ด้านขวาบนจอกว้าง — ไม่มีชิปเชน/ข้อความ contract */
          <section aria-labelledby="mine-h" className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            {mine.length === 0 || !top ? (
              <SkeletonRows rows={1} cols={[200]} />
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <TokenLogo token={top.logo} tokenName={top.symbol} chain={chainOf(chains, top.chain)?.logo ?? null} chainName={chainOf(chains, top.chain)?.name ?? top.chain} size={44} />
                  <div className="flex min-w-0 flex-col">
                    <h2 id="mine-h" className="text-xs text-muted-foreground">
                      {t('bal.mine')}
                    </h2>
                    <span className="truncate text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">
                      {formatAmount(mineTotal)} <span className="text-base font-medium text-muted-foreground">{top.symbol}</span>
                    </span>
                    {mineUsd !== null && <span className="text-sm text-muted-foreground tabular-nums">≈ {formatUsdExact(mineUsd)}</span>}
                  </div>
                </div>
                {topAddr && (
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" onClick={() => copy(top.tokenId)}>
                      <CopyIcon data-icon="inline-start" />
                      {t('bal.copyAddress')}
                    </Button>
                    {topHost && (
                      <Button variant="outline" render={<a href={`${topHost}/token/${top.tokenId}`} target="_blank" rel="noopener noreferrer" />}>
                        <GlobeIcon data-icon="inline-start" />
                        {t('bal.explorer')}
                      </Button>
                    )}
                  </div>
                )}
              </>
            )}
          </section>
        )}
        <PageTabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'history', label: t('token.history', { sym: symbol }), count: list.length },
            { value: 'holders', label: t('tab.holders'), count: holders.length },
          ]}
        />
        {tab === 'history' ? (
          <TxTable rows={list} wallets={all} chains={chains} wallet={wallet?.id ?? ''} onWallet={(id) => (id ? onWallet(id) : onScopeAll())} selected={selected} onSelect={onSelect} loading={th.supported ? th.loading : loading} hasMore={th.hasMore} onMore={th.supported ? th.more : undefined} />
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
