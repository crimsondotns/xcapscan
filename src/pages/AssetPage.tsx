/**
 * หน้าโทเคนหนึ่งตัว — ประวัติเฉพาะโทเคนนั้น ดูได้ทั้งแบบทุกกระเป๋าและเฉพาะกระเป๋าที่เข้ามา
 * ข้อมูลมาจากธุรกรรมที่โหลดไว้แล้วเท่านั้น ไม่มีการยิงคำขอเพิ่มของหน้านี้เอง
 */
import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import type { TxRow } from '../feed';
import type { ChainMap } from '../chains';
import type { Wallet } from '../store';
import type { GroupId } from '../groups';
import { rowsOfToken, tokenSummary, withinDays } from '../flow';
import { formatAmount, formatAmountFull, formatDecimalText, formatUsdExact } from '../format';
import { useI18n } from '../i18n';
import { useCopy } from '../copy';
import type { Range } from '../components/FlowChart';
import { useGroupLabel } from '../components/GroupNav';
import { TxTable } from '../components/TxTable';
import { TokenLogo } from '../components/Logo';
import { SkeletonBar, SkeletonRows } from '../components/Skeleton';
import { Icon } from '../components/Icon';
import { chainOf } from '../chains';
import { priceOf } from '../prices';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { CopyIcon, GlobeIcon } from 'lucide-react';
import { addDec, isTokenAddress, useBalances, walletTokenUrl } from '../balances';
import { useTokenHistory } from '../tokenFeed';
import { useStore } from '../store';

/** หน้าโทเคนแบบทุกกระเป๋า — ไม่มีกระเป๋าให้ดูยอด (ตระกูล sol = ไม่ยิงคำขอ) */
const NO_WALLET = { id: '', label: '', address: '', family: 'sol', enabled: true } as unknown as Wallet;

export function AssetPage({ onEnsure, tokenKey, wallet, all, rows, chains, group, range, onRange, onBack, onBackWallet, onWallet, onScopeAll, selected, onSelect, loading }: { onEnsure: (w: Wallet) => void; tokenKey: string; wallet: Wallet | null; all: Wallet[]; rows: TxRow[]; chains: ChainMap; group: GroupId; range: Range; onRange: (r: Range) => void; onBack: () => void; onBackWallet: () => void; onWallet: (id: string) => void; onScopeAll: () => void; selected: string | null; onSelect: (r: TxRow) => void; loading: boolean }) {
  const { t } = useI18n();
  const copy = useCopy();
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
  /* ชื่อบน breadcrumb: ห้ามโชว์ token address แทนชื่อ (ผู้ใช้ 2026-10-02) — กำลังโหลด = Skeleton, หาไม่เจอ = "Unknown token" */
  const named = balHit?.symbol ?? histHit?.symbol ?? (isTokenAddress(tokenKey) ? null : tokenKey);
  const tokenChain = balHit?.chain ?? histHit?.chain ?? null;
  /* ประวัติของโทเคนนี้จากแหล่งโดยตรง (chain_id + token_id) — เร็วกว่าไล่ทั้งกระเป๋า; ไม่ได้ก็กรองจากที่โหลดไว้ */
  const th = useTokenHistory(wallet, settings.endpoints, tokenChain, byId ? tokenKey : null, settings.pageSize);
  /* ขอประวัติทั้งกระเป๋าเฉพาะเมื่อแหล่งกรองรายโทเคนไม่ได้ (ต้องกรองในเครื่อง) — ปกติใช้ useTokenHistory อย่างเดียว */
  const needWalletHistory = !!wallet && !th.supported && !(bal.loading || th.loading);
  useEffect(() => {
    if (needWalletHistory && wallet) onEnsure(wallet);
  }, [needWalletHistory, wallet, onEnsure]);
  const local = useMemo(() => (byId ? rows.filter((r) => r.moves.some((m) => m.amount !== 0 && m.tokenId?.toLowerCase() === k)) : rowsOfToken(rows, symbol)), [rows, byId, k, symbol]);
  const list = useMemo(() => {
    if (!th.supported) return local;
    const seen = new Set(th.rows.map((r) => r.key));
    return [...th.rows, ...local.filter((r) => !seen.has(r.key))].sort((a, b) => b.time - a.time);
  }, [th.supported, th.rows, local]);
  const ranged = useMemo(() => withinDays(list, range), [list, range]);
  const token = useMemo(() => tokenSummary(ranged).find((x) => x.symbol === symbol) ?? tokenSummary(list).find((x) => x.symbol === symbol) ?? null, [ranged, list, symbol]);
  const pending = (th.supported ? th.loading : loading) && list.length === 0;
  const mine = useMemo(() => (wallet && bal.data ? bal.data.rows.filter((r) => (byId ? r.tokenId.toLowerCase() === k : r.symbol === symbol)) : []), [wallet, bal.data, byId, k, symbol]);
  const top = mine[0] ?? null;
  /* ผลรวมหลายเชน: ตัดเศษทศนิยมลอยตัว (0.1+0.2) ที่ 15 หลักนัยสำคัญ */
  const mineTotal = Number(mine.reduce((n, r) => n + r.amount, 0).toPrecision(15));
  /* กดที่ตัวเลข = สลับย่อ ↔ ทศนิยมครบทุกหลัก (ผู้ใช้ 2026-10-02) — ครบ = ผลรวมแบบสตริงจากข้อความดิบของแหล่ง (ไม่ผ่าน float) */
  const mineExact = mine.length && mine.every((r) => r.exact) ? mine.reduce((acc, r) => addDec(acc, r.exact!), '0') : null;
  const [fullAmt, setFullAmt] = useState(false);
  const mineUsd = mine.some((r) => r.usd !== null) ? mine.reduce((n, r) => n + (r.usd ?? 0), 0) : null;
  const topAddr = !!top && isTokenAddress(top.tokenId);
  /* Explorer = กระเป๋าของลูกค้า กรองเฉพาะโทเคนนี้ (ผู้ใช้ 2026-10-02) */
  const topUrl = top && wallet ? walletTokenUrl(chainOf(chains, top.chain)?.explorer, wallet.family, wallet.address, top.tokenId) : null;
  const chain = chainOf(chains, token?.chain ?? top?.chain ?? tokenChain ?? '') ?? undefined;
  const price = top?.price ?? (token ? priceOf(token.chain, token.tokenId, token.symbol) : null);

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
            <BreadcrumbPage>{named ?? (bal.loading || th.loading || loading ? <SkeletonBar width={64} /> : t('token.unknown'))}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      {/* ใต้ breadcrumb: ไม่ซ้อน padding บนของการ์ดกับ gap ของ stack; มือถือชิดขอบหน้าเท่าหัวเว็บ (เหมือน WalletPage) */}
      <section className="panel pt-0 max-sm:px-0">
        {wallet && bal.supported && (mine.length > 0 || bal.loading) && (
          /* การ์ด My balance แบบ A (ผู้ใช้ 2026-10-02): ตัวเลขใหญ่ + ≈ USD; ปุ่มคัดลอก/explorer ด้านขวาบนจอกว้าง — ไม่มีชิปเชน/ข้อความ contract */
          <section aria-labelledby="mine-h" className="mb-2 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            {mine.length === 0 || !top ? (
              <SkeletonRows rows={1} cols={[200]} />
            ) : (
              <>
                <div className="flex items-center gap-4">
                  <TokenLogo token={top.logo} tokenName={top.symbol} chain={chainOf(chains, top.chain)?.logo ?? null} chainName={chainOf(chains, top.chain)?.name ?? top.chain} size={48} />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <h2 id="mine-h" className="text-xs text-muted-foreground">
                      {t('bal.mine')}
                    </h2>
                    <button type="button" aria-pressed={fullAmt} title={t(fullAmt ? 'bal.showShort' : 'bal.showFull')} onClick={() => setFullAmt((v) => !v)} className={cn('cursor-pointer rounded-sm text-left text-2xl font-semibold tracking-tight tabular-nums outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:text-3xl', fullAmt ? 'break-all' : 'truncate')}>
                      {fullAmt ? (mineExact ? formatDecimalText(mineExact) : formatAmountFull(mineTotal)) : formatAmount(mineTotal)} <span className="text-base font-medium text-muted-foreground">{top.symbol}</span>
                    </button>
                    {mineUsd !== null && <span className="text-sm text-muted-foreground tabular-nums">≈ {formatUsdExact(mineUsd)}</span>}
                  </div>
                </div>
                {(topAddr || topUrl) && (
                  <div className="flex flex-wrap gap-2">
                    {topAddr && (
                      <Button type="button" variant="outline" onClick={() => copy(top.tokenId)}>
                        <CopyIcon data-icon="inline-start" />
                        {t('bal.copyAddress')}
                      </Button>
                    )}
                    {topUrl && (
                      <Button variant="outline" render={<a href={topUrl} target="_blank" rel="noopener noreferrer" />}>
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
        {/* แท็บ Related wallets ถูกลบ (ผู้ใช้ 2026-10-02) — หน้าโทเคนเหลือประวัติอย่างเดียว */}
        <TxTable rows={list} wallets={all} chains={chains} wallet={wallet?.id ?? ''} onWallet={(id) => (id ? onWallet(id) : onScopeAll())} selected={selected} onSelect={onSelect} loading={th.supported ? th.loading : loading} hasMore={th.hasMore} onMore={th.supported ? th.more : undefined} />
      </section>
    </>
  );
}
