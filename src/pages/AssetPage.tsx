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
import { CopyIcon } from 'lucide-react';
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
          <section aria-labelledby="mine-h" className="flex flex-col gap-2">
            <h2 id="mine-h" className="text-sm text-muted-foreground">
              {t('bal.mine')}
            </h2>
            {mine.length === 0 ? (
              <SkeletonRows rows={1} cols={[160, 120]} />
            ) : (
              <Table>
                <TableBody>
                  {mine.map((r) => {
                    const c = chainOf(chains, r.chain);
                    /* เหรียญหลัก = id เท่ากับชื่อเชน / ไม่ใช่ที่อยู่ 0x; ลิงก์ explorer เฉพาะที่อยู่เต็ม */
                    const isAddr = r.tokenId.startsWith('0x') && r.tokenId !== r.chain;
                    const fullAddr = /^0x[0-9a-f]{40}$/i.test(r.tokenId);
                    const host = c?.explorer?.replace(/\/+$/, '');
                    return (
                      <TableRow key={`${r.chain}:${r.tokenId}`}>
                        <TableCell>
                          <span className="who">
                            <TokenLogo token={r.logo} tokenName={r.symbol} chain={c?.logo ?? null} chainName={c?.name ?? r.chain} size={32} />
                            <span className="act-text min-w-0">
                              <span className="act-title truncate">
                                {formatAmount(r.amount)} {r.symbol}
                              </span>
                              <span className="act-sub truncate">{r.usd !== null ? `≈ ${formatUsdExact(r.usd)}` : c?.name ?? r.chain}</span>
                            </span>
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          {isAddr ? (
                            <span className="inline-flex items-center gap-1">
                              <span className="sr-only">{t('bal.contract')}</span>
                              <span className="mono text-muted-foreground" title={r.tokenId}>
                                {shortAddr(r.tokenId)}
                              </span>
                              <Button type="button" variant="ghost" size="icon-xs" onClick={() => copy(r.tokenId)} aria-label={t('token.copyAddress', { sym: r.symbol })} title={t('token.copyAddress', { sym: r.symbol })}>
                                <CopyIcon />
                              </Button>
                              {host && fullAddr && (
                                <Button variant="ghost" size="xs" render={<a href={`${host}/token/${r.tokenId}`} target="_blank" rel="noopener noreferrer" />}>
                                  {t('bal.viewExplorer')}
                                </Button>
                              )}
                            </span>
                          ) : (
                            <span className="text-muted-foreground" title={t('token.native')}>
                              {t('bal.native')}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
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
