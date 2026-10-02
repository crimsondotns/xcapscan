/**
 * หน้ากระเป๋าหนึ่งใบ — สรุปกระแสเงินของกระเป๋านี้ แล้วเลือกดูเป็นรายโทเคนหรือรายธุรกรรม
 * แท็กแก้ได้ตรงนี้ (ที่เดียวที่ตั้งได้) เพราะมันคือที่ที่ผู้ใช้กำลังดูกระเป๋าใบนั้นอยู่
 */
import { useMemo, useState, useEffect } from 'react';
import type { TxRow } from '../feed';
import type { ChainMap } from '../chains';
import type { Wallet } from '../store';
import type { GroupId } from '../groups';
import { signClassOf, tokenSummary, totals, withinDays } from '../flow';
import { formatUsdExact, shortAddr } from '../format';
import { useI18n } from '../i18n';
import type { Range } from '../components/FlowChart';
import { useGroupLabel } from '../components/GroupNav';
import { PageTabs } from '../components/PageTabs';
import { TokenTable } from '../components/TokenTable';
import { BalanceTable } from '../components/BalanceTable';
import { useBalances } from '../balances';
import { useStore } from '../store';
import { TxTable } from '../components/TxTable';
import { Identicon } from '../components/Identicon';
import { Icon } from '../components/Icon';
import { TagDialog } from '../components/TagDialog';
import { Button } from '@/components/ui/button';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import type { OlderOpts } from '../useFeed';

/** ไล่ย้อนหลังตามตัวกรองวันที่: ขนาดหน้าที่ใช้ และแหล่งกระโดดตามเวลาได้ไหม */
type BulkOpts = { count: number; seek: boolean };

// 👇 เพิ่ม onFetchMeta เข้าไปใน props
export function WalletPage({ 
  wallet, all, rows, chains, group, range, onRange, onBack, onWallet, onToken, selected, onSelect, loading, hasMore, onMore, onReload, onFetchMeta, bulk 
}: { 
  wallet: Wallet; 
  all: Wallet[]; 
  rows: TxRow[]; 
  chains: ChainMap; 
  group: GroupId; 
  range: Range; 
  onRange: (r: Range) => void; 
  onBack: () => void; 
  onWallet: (id: string) => void; 
  onToken: (symbol: string) => void; 
  selected: string | null; 
  onSelect: (r: TxRow) => void; 
  loading: boolean; 
  hasMore: boolean; 
  onMore: (opts?: OlderOpts) => void;
  bulk?: BulkOpts; 
  onReload: () => void;
  onFetchMeta: (w: Wallet) => void; // 👈 Type ของฟังก์ชันที่ส่งมา
})   {
  const { t } = useI18n();
  const [tab, setTab] = useState<'tokens' | 'history'>('tokens');
  const [tagsOpen, setTagsOpen] = useState(false);
  const tags = wallet.tags ?? [];
  const groupLabel = useGroupLabel(all, group);
  const ranged = useMemo(() => withinDays(rows, range), [rows, range]);
  const sums = useMemo(() => totals(ranged), [ranged]);
  const tokens = useMemo(() => tokenSummary(ranged), [ranged]);
  const pending = loading && rows.length === 0;
  /* ยอดคงเหลือจริง (แหล่ง ERC-20) — โหลดเมื่อเปิดแท็บ Tokens; กระเป๋า Solana ใช้สรุปเข้า-ออกเดิม */
  const { settings } = useStore();
  const bal = useBalances(wallet, settings.endpoints, tab === 'tokens');
  const balTotal = bal.data?.rows.reduce((s, r) => s + (r.usd ?? 0), 0) ?? null;

  // 👇👇👇 เพิ่ม useEffect นี้ 👇👇👇
  useEffect(() => {
    if (wallet && tab === 'tokens') {
      void onFetchMeta(wallet);
    }
  }, [wallet, tab, onFetchMeta]);
  // 👆👆👆 เพิ่ม useEffect นี้ 👆👆👆

  return (
    <>
      <Breadcrumb aria-label={t('nav.back')}>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<button type="button" onClick={onBack} />}>{groupLabel}</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{wallet.label}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <section className="panel">
        <PageTabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'tokens', label: t('tab.tokens'), count: bal.supported ? (bal.data?.rows.length ?? 0) : tokens.length },
            { value: 'history', label: t('tab.history'), count: rows.length },
          ]}
        />
        {tab === 'tokens' ? bal.supported ? <BalanceTable bal={bal} chains={chains} onToken={onToken} /> : <TokenTable rows={ranged} chains={chains} onToken={onToken} loading={loading} /> : <TxTable rows={rows} wallets={all} chains={chains} wallet={wallet.id} onWallet={(id) => onWallet(id)} onToken={onToken} selected={selected} onSelect={onSelect} loading={loading} hasMore={hasMore} onMore={onMore} bulk={bulk} />}
      </section>
      <TagDialog open={tagsOpen} wallet={wallet} onClose={() => setTagsOpen(false)} />
    </>
  );
}