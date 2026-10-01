import { useMemo, useState } from 'react';
import { useI18n } from '../i18n';
import { useStore, type Wallet } from '../store';
import type { WalletFeed } from '../useFeed';
import { shortAddr } from '../format';
import { Icon } from './Icon';
import { AddWalletDialog } from './AddWalletDialog';
import { Identicon } from './Identicon';
import { ConfirmDialog, type ConfirmState } from './ConfirmDialog';
import { useInfinite } from '../useInfinite';
import { MoreSentinel } from './MoreSentinel';
import { SkeletonBar } from './Skeleton';
import { useStickyHead } from '../useStickyHead';
import { Logo } from './Logo';
import { chainOf, type ChainInfo, type ChainMap } from '../chains';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SearchIcon } from 'lucide-react';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Badge } from '@/components/ui/badge';

type SortKey = 'label' | 'tag';
const PAGE = 20;

/** ชุด chain เริ่มต้นต่อตระกูล — โชว์ตอนยังไม่โหลดว่า wallet นี้อยู่บนเครือข่ายอะไรได้บ้าง */
const DEFAULT_CHAINS: Record<string, string[]> = {
  erc20: ['eth', 'arb', 'base', 'op', 'bsc'],
  sol: ['sol'],
};

/**
 * โลโก้เชนในคอลัมน์ Support — กระเป๋าที่โหลดแล้วแสดงโลโก้เชนจริงจากธุรกรรม
 * กระเป๋าที่ยังไม่โหลดแสดงชุด chain ของตระกูลนั้น (EVM: eth/arb/base/op/bsc, Solana: sol)
 * ถ้า chain list ยังไม่มา ใช้จุดสีตามตระกูลแทน
 */
function WalletMarks({ family, chainIds, chains }: { family: string; chainIds: string[]; chains: ChainMap }) {
  // โหลดแล้ว → โลโก้เชนจริงจากธุรกรรม
  if (chainIds.length) {
    return (
      <span className="chain-marks">
        {chainIds.slice(0, 5).map((c) => {
          const info = chainOf(chains, c);
          return <Logo key={c} src={info?.logo ?? null} name={info?.name ?? c} size={18} />;
        })}
        {chainIds.length > 5 && <span className="idle">+{chainIds.length - 5}</span>}
      </span>
    );
  }

  // ยังไม่โหลด → แสดงชุด chain เริ่มต้นของตระกูลนั้น
  const defaults = DEFAULT_CHAINS[family] ?? [];
  const infos = defaults.map((id) => chainOf(chains, id)).filter((c): c is ChainInfo => !!c?.logo);
  if (infos.length) {
    return (
      <span className="chain-marks">
        {infos.slice(0, 5).map((c) => (
          <Logo key={c.id} src={c.logo} name={c.name} size={18} />
        ))}
      </span>
    );
  }

  // chain list ยังไม่มา → วงกลมสีตามตระกูล
  const isSol = family === 'sol';
  const label = isSol ? 'Solana' : 'ERC-20';
  return (
    <span
      title={label}
      aria-label={label}
      style={{
        display: 'inline-block',
        width: 14,
        height: 14,
        borderRadius: '50%',
        background: isSol ? 'linear-gradient(135deg, #9945FF 0%, #14F195 100%)' : '#627EEA',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.15)',
      }}
    />
  );
}

/**
 * ตารางกระเป๋าของกลุ่มที่เลือก — กระเป๋า · แท็ก · เชน
 * คลิกแถว = ไปหน้ากระเป๋า; หัวคอลัมน์เรียงได้; แสดงทีละ 20 แถว เลื่อนลงแล้วเพิ่มเอง
 * ถังขยะ = ยืนยันก่อนลบ
 */
export function WalletTable({ wallets, feeds, chains, activeId, onOpen, onSwitch, onRemove, hasSource }: { wallets: Wallet[]; feeds: Record<string, WalletFeed>; chains: ChainMap; activeId: string | null; onOpen: (id: string) => void; onSwitch: (id: string | null) => void; onRemove: (id: string) => void; hasSource: (w: Wallet) => boolean }) {
  const { t } = useI18n();
  const { wallets: all, removeWallet, clearWallets } = useStore();
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const [confirmDialog, setConfirmDialog] = useState<ConfirmState | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'label', dir: 'asc' });
  const head = useStickyHead();

  function remove(w: Wallet) {
    setConfirmDialog({ type: 'deleteWallet', title: t('confirm.deleteTitle'), message: t('confirm.deleteMsg', { label: w.label }), walletId: w.id });
  }
  function clear() {
    if (!all.length) return;
    setConfirmDialog({ type: 'clearAll', title: t('confirm.clearTitle'), message: t('wallets.clearConfirm', { n: all.length }), walletId: null });
  }
  /* ผู้ใช้กดยืนยัน → ทำจริง; ไม่มี dialog ค้าง → ไม่ทำอะไร */
  function confirmAction() {
    const c = confirmDialog;
    setConfirmDialog(null);
    if (!c) return null;
    if (c.type === 'deleteWallet' && c.walletId) {
      removeWallet(c.walletId);
      onRemove(c.walletId);
      if (activeId === c.walletId) onSwitch(null);
    } else if (c.type === 'clearAll') {
      clearWallets();
      all.forEach((w) => onRemove(w.id));
      onSwitch(null);
    }
    return c.type;
  }

  const rowsOf = (w: Wallet) => feeds[w.id]?.rows ?? [];
  /* เชนที่กระเป๋าใบนี้มีธุรกรรมจริง (จากที่โหลดมาแล้ว) — โลโก้อย่างเดียว ไม่ใส่ชื่อ */
  const chainsOf = (w: Wallet) => [...new Set(rowsOf(w).map((r) => r.chain))];
  const isLoading = (w: Wallet) => feeds[w.id]?.loading === true;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return wallets;
    return wallets.filter((w) => w.label.toLowerCase().includes(needle) || w.address.toLowerCase().includes(needle) || (w.tags ?? []).some((x) => x.toLowerCase().includes(needle)));
  }, [wallets, q]);

  const sorted = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1;
    const val = (w: Wallet): string => {
      if (sort.key === 'tag') return (w.tags ?? []).join(' ').toLowerCase();
      return w.label.toLowerCase();
    };
    return [...filtered].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      return (x > y ? 1 : x < y ? -1 : 0) * dir;
    });
  }, [filtered, sort]);
  const inf = useInfinite({ total: sorted.length, page: PAGE, hasMore: false, loading: false, resetKey: `${sort.key}${sort.dir}${q}` });
  const visible = sorted.slice(0, inf.visible);

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  }
  const Th = ({ k, label }: { k: SortKey; label: string }) => (
    <TableHead scope="col" aria-sort={sort.key === k ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <Button type="button" variant="ghost" size="sm" className="-ml-2.5 font-medium text-muted-foreground" onClick={() => toggleSort(k)}>
        {label}
        <Icon name={sort.key === k ? (sort.dir === 'asc' ? 'chevronUp' : 'chevronDown') : 'chevronsUpDown'} className="th-ico" />
      </Button>
    </TableHead>
  );

  return (
    <>
      <div className="toolbar" role="search">
        <label className="sr-only" htmlFor="wallet-q">
          {t('wallets.title')}
        </label>
        <InputGroup className="max-w-sm">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput id="wallet-q" name="wq" type="search" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" spellCheck={false} />
        </InputGroup>
        <div className="row-actions">
          <Button type="button" variant="outline" onClick={() => setAdding(true)}>
            <Icon name="plus" />
            {t('wallets.add')}
          </Button>
          {all.length > 0 && (
            <Button type="button" variant="ghost" size="icon" onClick={clear} aria-label={t('wallets.clear')} title={t('wallets.clear')}>
              <Icon name="trash" />
            </Button>
          )}
        </div>
        <span className="count" aria-live="polite">
          {t('wallets.count', { n: sorted.length })}
        </span>
      </div>

      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('wallets.empty')}</p>
      ) : (
        <div className="table-wrap wtab-wrap">
          <Table containerClassName="lg:overflow-visible" className="tx wtab">
            <TableHeader ref={head.ref} data-stuck={head.stuck}>
              <TableRow>
                <Th k="label" label={t('wallets.col.label')} />
                <Th k="tag" label={t('wallets.col.tag')} />
                <TableHead scope="col">{t('wallets.col.support')}</TableHead>
                <TableHead scope="col" className="num">
                  <span className="sr-only">{t('wallets.title')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((w) => {
                const loading = isLoading(w);
                return (
                  <TableRow
                    key={w.id}
                    className="tx-row wt-row"
                    aria-selected={activeId === w.id}
                    data-hidden={!w.enabled}
                    tabIndex={0}
                    onClick={() => onOpen(w.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onOpen(w.id);
                      }
                    }}
                  >
                    <TableCell>
                      <span className="wt-cell">
                        <Identicon value={w.address} size={36} />
                        <span className="act-text">
                          <span className="act-title wt-label">{w.label}</span>
                          <span className="act-sub mono">{shortAddr(w.address)}</span>
                        </span>
                      </span>
                    </TableCell>
                    <TableCell>
                      {w.tags?.length ? (
                        <span className="flex flex-wrap gap-1">
                          {w.tags.map((tag) => (
                            <Badge key={tag} variant="secondary">
                              {tag}
                            </Badge>
                          ))}
                        </span>
                      ) : (
                         <span className="idle">—</span>
                      )}
                    </TableCell>
                    <TableCell>{loading ? <SkeletonBar width={64} /> : <WalletMarks family={w.family} chainIds={chainsOf(w)} chains={chains} />}</TableCell>
                    <TableCell className="num">
                      <span className="wallet-actions" onClick={(e) => e.stopPropagation()}>
                        <Button type="button" variant="ghost" size="icon" onClick={() => remove(w)} aria-label={t('wallets.remove', { label: w.label })} title={t('wallets.remove', { label: w.label })}>
                          <Icon name="trash" />
                        </Button>
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <MoreSentinel sentinel={inf.sentinel} loading={false} exhausted={inf.exhausted} page={PAGE} count={sorted.length} />
        </div>
      )}

      <AddWalletDialog open={adding} onClose={() => setAdding(false)} />
      <ConfirmDialog state={confirmDialog} onConfirm={confirmAction} onCancel={() => setConfirmDialog(null)} />
    </>
  );
}