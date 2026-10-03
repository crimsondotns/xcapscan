import { BackToTop } from './components/BackToTop';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from './i18n';
import { useStore } from './store';
import { bulkCount, endpointsFor, hasOlder, seeksByTime, useFeed } from './useFeed';
import { XCapMark } from './components/XCapMark';
import { DatabaseIcon, SettingsIcon, ShieldCheckIcon, TriangleAlertIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { ImportDialog } from './components/ImportDialog';
import { DetailPanel } from './components/DetailPanel';
import type { TxRow } from './feed';
import { useChains } from './chains';
import { SettingsDialog } from './components/SettingsDialog';
import { VerifyDialog } from './components/VerifyDialog';
import { parseShare } from './slip';
import { LangMenu } from './components/LangMenu';
import { ThemeToggle } from './components/ThemeToggle';
import { setProxy } from './proxy';
import { navigate, useRoute } from './router';
import { lastTime } from './flow';
import { groupExists, matchesGroup, type GroupId } from './groups';
import { GroupDrawer, GroupMenubar } from './components/GroupNav';
import { Finder } from './components/Finder';
import { Dashboard } from './pages/Dashboard';
import { WalletPage } from './pages/WalletPage';
import type { Wallet } from './store';
import { AssetPage } from './pages/AssetPage';
import type { Range } from './components/FlowChart';

/** เส้นทาง (ชื่อเต็ม): '' = แดชบอร์ด · 'group/<กลุ่ม>' · 'settings' / 'import' = ไดอะล็อกบนแดชบอร์ด
 *  · 'wallet/<id>' · 'token/<sym>' (ทุกกระเป๋า) · 'wallet/<id>/token/<sym>' · 'verify/<code>' = ตรวจสลิป
 *  ไดอะล็อก Settings / Import = '?open=settings' / '?open=import' ต่อท้ายหน้าไหนก็ได้ (หน้าข้างหลังไม่เปลี่ยน)
 *  ลิงก์แบบย่อเดิม (g/ t/ h/ v/ และ '<id>' เปล่า) ยังเปิดได้ — ลิงก์สลิปที่แชร์ไปแล้วต้องไม่เสีย */
type Parsed = { wallet: string | null; token: string | null; share: string | null; group: GroupId | null; dialog: 'settings' | 'import' | null };
const TOKEN_SEG = new Set(['token', 't']);
function parseRoute(route: string): Parsed {
  const seg = route.split('/').filter(Boolean).map(decodeURIComponent);
  const none: Parsed = { wallet: null, token: null, share: null, group: null, dialog: null };
  const head = seg[0];
  if (head === 'verify' || head === 'v') return { ...none, share: seg.slice(1).join('/') };
  if (head && TOKEN_SEG.has(head)) return { ...none, token: seg[1] ?? null };
  if (head === 'group' || head === 'g') return { ...none, group: seg[1] ?? null };
  if (head === 'settings' || head === 'import') return { ...none, dialog: head };
  if (!head) return none;
  const rest = head === 'wallet' ? seg.slice(1) : seg;
  if (!rest[0]) return none;
  return { ...none, wallet: rest[0], token: rest[1] && TOKEN_SEG.has(rest[1]) ? (rest[2] ?? null) : null };
}

const groupPath = (g: GroupId) => (g === 'all' ? '' : `group/${encodeURIComponent(g)}`);
const walletPath = (id: string) => `wallet/${encodeURIComponent(id)}`;
const tokenPath = (symbol: string, walletId: string | null) => (walletId ? `${walletPath(walletId)}/token/${encodeURIComponent(symbol)}` : `token/${encodeURIComponent(symbol)}`);

export function App() {
  const { t } = useI18n();
  const { wallets, settings } = useStore();
  const { feeds, loadMany, loadStaggered, cancelStaggered, progress, ensure, reset, forget, fillMeta } = useFeed(settings);
  const route = useRoute();
  const parsed = useMemo(() => parseRoute(route), [route]);
  /* ไดอะล็อก Settings/Import เป็น state ล้วน ไม่มี route/query (ผู้ใช้ 2026-10-02) */
  const [open, setOpen] = useState<'settings' | 'import' | null>(null);
  const settingsOpen = open === 'settings';
  const importing = open === 'import';
  const openDialog = useCallback((d: 'settings' | 'import') => setOpen(d), []);
  const closeDialog = useCallback(() => setOpen(null), []);
  /* ลิงก์เก่า /settings, /import หรือ ?open= → แดชบอร์ด แล้วเปิดไดอะล็อกนั้น (ล้าง URL) */
  useEffect(() => {
    const q = new URLSearchParams(location.search).get('open');
    const d = parsed.dialog ?? (q === 'settings' || q === 'import' ? q : null);
    if (!d) return;
    setOpen(d);
    navigate(parsed.dialog ? '' : route, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed.dialog]);
  const pageWallet = parsed.wallet;
  const pageToken = parsed.token;
  /* /verify/<code>[.<data>] = ลิงก์ตรวจสลิป → เปิดไดอะล็อกตรวจทับแดชบอร์ด */
  const share = useMemo(() => (parsed.share === null ? null : parseShare(parsed.share)), [parsed.share]);
  const [verifyOpen, setVerifyOpen] = useState(false);
  useEffect(() => {
    if (share) setVerifyOpen(true);
  }, [share]);
  const page: 'dashboard' | 'wallet' | 'asset' = pageToken ? 'asset' : pageWallet ? 'wallet' : 'dashboard';
  const [selected, setSelected] = useState<TxRow | null>(null);
  /* กลุ่มกระเป๋าที่เลือกอยู่ — อยู่ใน URL ของแดชบอร์ด ('group/<กลุ่ม>'); หน้าย่อยจำกลุ่มล่าสุดไว้ */
  const [group, setGroupState] = useState<GroupId>(parsed.group ?? 'all');
  useEffect(() => {
    if (page === 'dashboard') setGroupState(parsed.group ?? 'all');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed]);
  const setGroup = useCallback((g: GroupId) => {
    setGroupState(g);
    navigate(groupPath(g));
  }, []);
  const [range, setRange] = useState<Range>(30);
  /* กระเป๋าที่กำลังดู (null = ทุกกระเป๋า) */
  const [activeWallet, setActiveWallet] = useState<string | null>(null);
  const closeDetail = useCallback(() => setSelected(null), []);

  /* ทางผ่านคำขอ (CORS) — ตั้งครั้งเดียวต่อค่าใน settings ให้ทุกตัวดึงข้อมูลใช้ */
  setProxy(settings.proxyUrl);
  const enabledEps = settings.endpoints.filter((e) => e.enabled);
  const chains = useChains(settings);
  const hasEndpoint = enabledEps.length > 0;
  const active = useMemo(() => wallets.filter((w) => w.enabled), [wallets]);

  /* โหลดแบบขี้เกียจ: ไม่ยิงตอนเปิดหน้า — ยิงเมื่อผู้ใช้เลือกกระเป๋าเท่านั้น และใช้แคชถ้าเคยโหลดแล้ว
     แหล่งข้อมูลเปลี่ยน → ล้างแคช (ไม่โหลดใหม่เอง) */
  const epKey = enabledEps.map((e) => `${e.id}:${e.url}:${e.family}`).join('|');
  const lastKey = useRef(epKey);
  useEffect(() => {
    if (lastKey.current === epKey) return;
    lastKey.current = epKey;
    reset();
  }, [epKey, reset]);

  /* เลือกกระเป๋าอย่างเดียว ไม่โหลด — หน้ากระเป๋า/หน้าโทเคนขอประวัติเองเฉพาะแท็บที่ต้องใช้ (ผู้ใช้ 2026-10-03) */
  const selectWallet = useCallback((id: string | null) => setActiveWallet(id), []);
  const ensureWallet = useCallback(
    (w: Wallet) => {
      if (hasEndpoint && endpointsFor(w, settings).length) void ensure(w);
    },
    [hasEndpoint, settings, ensure],
  );
  const openWallet = useCallback(
    (id: string | null) => {
      selectWallet(id);
      navigate(id ? walletPath(id) : '');
    },
    [selectWallet],
  );
  const openToken = useCallback(
    (symbol: string, walletId: string | null) => {
      if (walletId) selectWallet(walletId);
      navigate(tokenPath(symbol, walletId));
    },
    [selectWallet],
  );
  const goDashboard = useCallback(() => {
    navigate(groupPath(group));
  }, [group]);
  /* เปิดด้วย URL ที่ชี้กระเป๋า → เลือกกระเป๋านั้นให้ (ถ้ายังมีอยู่) */
  useEffect(() => {
    if (!pageWallet) return;
    if (!wallets.some((w) => w.id === pageWallet)) return goDashboard();
    if (activeWallet !== pageWallet) selectWallet(pageWallet);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageWallet, wallets]);
  /* ลบแท็ก/กระเป๋าสุดท้ายของกลุ่มที่เลือกอยู่ → กลุ่มนั้นหายไป กลับไปที่ "ทุกกระเป๋า" */
  useEffect(() => {
    if (groupExists(group, wallets)) return;
    setGroupState('all');
    if (parsed.group) navigate('', true);
  }, [group, wallets, parsed.group]);

  const infoOf = useCallback((w: { id: string }) => ({ loaded: feeds[w.id]?.loaded === true, last: lastTime(feeds[w.id]?.rows ?? []) }), [feeds]);
  /* กระเป๋าของกลุ่มที่เลือก (ทั้งที่ซ่อนอยู่ด้วย — ตารางยังต้องเห็นเพื่อเปิดกลับ) */
  const groupWallets = useMemo(() => wallets.filter((w) => matchesGroup(group, w, infoOf(w))), [wallets, group, infoOf]);
  const rows = useMemo(() => active.flatMap((w) => feeds[w.id]?.rows ?? []).sort((a, b) => b.time - a.time), [active, feeds]);
  const groupRows = useMemo(() => {
    const ids = new Set(groupWallets.filter((w) => w.enabled).map((w) => w.id));
    return rows.filter((r) => ids.has(r.walletId));
  }, [rows, groupWallets]);

  /*
   * ปิด auto-load บนแดชบอร์ด — ไม่ยิง API จนกว่าผู้ใช้จะกดเอง
   * โหลดเกิดขึ้นได้ 3 ทางเท่านั้น:
   *   1) คลิกกระเป๋า → selectWallet → ensure(w)
   *   2) กดปุ่ม "โหลดกลุ่ม" → loadGroup → loadStaggered
   *   3) กดปุ่ม reload ในหน้ากระเป๋า → loadMany([w], 'reset')
   *
   * const startedFor = useRef<string | null>(null);
   * useEffect(() => {
   *   if (page !== 'dashboard' || !hasEndpoint || !active.length) return;
   *   if (startedFor.current === epKey) return;
   *   startedFor.current = epKey;
   *   void loadStaggered(active);
   *   // eslint-disable-next-line react-hooks/exhaustive-deps
   * }, [page, hasEndpoint, epKey, active.length]);
   */

  const walletRows = useMemo(() => (pageWallet ? rows.filter((r) => r.walletId === pageWallet) : rows), [rows, pageWallet]);
  const anyLoading = active.some((w) => feeds[w.id]?.loading);
  const activeWalletObj = wallets.find((w) => w.id === pageWallet) ?? null;
  const errors = active.flatMap((w) => Object.entries(feeds[w.id]?.errors ?? {}).map(([epId, e]) => ({ w, ep: settings.endpoints.find((x) => x.id === epId), e })));
  const loadGroup = useCallback(() => {
    void loadStaggered(groupWallets.filter((w) => w.enabled && !feeds[w.id]?.loaded));
  }, [groupWallets, feeds, loadStaggered]);

  /* ห้ามบอกผู้ใช้ว่าเป็นแหล่งข้อมูลไหน — บอกแค่กระเป๋ากับสาเหตุ */
  function errMsg({ w, e }: (typeof errors)[number]): string {
    const msg = e.kind === 'http' && e.status === 429 ? t('tx.errorRate') : e.kind === 'http' ? t('tx.errorHttp', { status: e.status }) : e.kind === 'shape' ? t('tx.errorShape') : t('tx.errorNet');
    return `${w.label}: ${t('tx.error', { msg })}`;
  }

  const errorList =
    errors.length > 0 ? (
      <Alert variant="destructive" aria-live="polite">
        <TriangleAlertIcon />
        <AlertDescription className="flex flex-col gap-1">
          {[...new Set(errors.map(errMsg))].map((m) => (
            <span key={m}>{m}</span>
          ))}
        </AlertDescription>
      </Alert>
    ) : null;

  return (
    <>
      <a className="skip" href="#main">
        {t('nav.skip')}
      </a>
      <header className="top flex-wrap gap-2 py-2 sm:gap-3">
        <div className="sm:hidden">
          <GroupDrawer wallets={wallets} infoOf={infoOf} group={group} onChange={setGroup} chains={chains} />
        </div>
        <button type="button" className="brand" onClick={goDashboard} aria-label={t('nav.dashboard')}>
          <XCapMark />
          {t('app.name')} <span className="brand-sub">{t('app.sub')}</span>
        </button>
        {page !== 'dashboard' && <div className="hidden md:flex"><GroupMenubar wallets={wallets} infoOf={infoOf} group={group} onChange={setGroup} chains={chains} /></div>}
        <span className="top-spacer" />
        <Button variant="ghost" size="icon" onClick={() => setVerifyOpen(true)} aria-label={t('slip.verify')} title={t('slip.verify')}>
          <ShieldCheckIcon />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => openDialog('settings')} aria-label={t('nav.settings')} title={t('nav.settings')}>
          <SettingsIcon />
        </Button>
        <ThemeToggle />
        <LangMenu />
        <Finder wallets={wallets} rows={rows} chains={chains} onWallet={(id) => openWallet(id)} onToken={openToken} />
      </header>

      <div className="layout">
        <main id="main" className="main">
          {!hasEndpoint ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <DatabaseIcon />
                </EmptyMedia>
                <EmptyTitle>{t('tx.emptyEndpoint')}</EmptyTitle>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={() => openDialog('settings')}>{t('nav.settings')}</Button>
              </EmptyContent>
            </Empty>
          ) : page === 'dashboard' ? (
            <div className="stack-lg">
              {errorList}
              <Dashboard
                all={wallets}
                wallets={groupWallets}
                rows={groupRows}
                feeds={feeds}
                chains={chains}
                group={group}
                onGroup={setGroup}
                infoOf={infoOf}
                range={range}
                onRange={setRange}
                onOpenWallet={openWallet}
                onSwitch={(id) => {
                  selectWallet(id);
                  const w = id ? wallets.find((x) => x.id === id) : undefined;
                  if (w) ensureWallet(w);
                }}
                onRemove={forget}
                onImport={() => openDialog('import')}
                hasSource={(w) => endpointsFor(w, settings).length > 0}
                onLoadGroup={loadGroup}
                loading={anyLoading}
                progress={progress}
                onCancel={cancelStaggered}
                selected={selected?.key ?? null}
                onSelect={setSelected}
              />
            </div>
          ) : page === 'asset' && pageToken ? (
            <div className="stack-lg">
              {errorList}
              <AssetPage
                onEnsure={ensureWallet}
                tokenKey={pageToken}
                wallet={activeWalletObj}
                all={wallets}
                rows={pageWallet ? walletRows : groupRows}
                chains={chains}
                group={group}
                range={range}
                onRange={setRange}
                onBack={goDashboard}
                onBackWallet={() => pageWallet && openWallet(pageWallet)}
                onWallet={(id) => openToken(pageToken, id)}
                onScopeAll={() => openToken(pageToken, null)}
                selected={selected?.key ?? null}
                onSelect={setSelected}
                loading={anyLoading}
              />
            </div>
          ) : activeWalletObj ? (
            <div className="stack-lg">
              {errorList}
              <WalletPage
                wallet={activeWalletObj}
                all={wallets}
                rows={walletRows}
                chains={chains}
                group={group}
                range={range}
                onRange={setRange}
                onBack={goDashboard}
                onWallet={(id) => openWallet(id || null)}
                onToken={(sym) => openToken(sym, activeWalletObj.id)}
                selected={selected?.key ?? null}
                onSelect={setSelected}
                loading={anyLoading}
                hasMore={hasOlder(feeds[activeWalletObj.id])}
                onMore={(o) => void loadMany([activeWalletObj], 'older', o)}
                bulk={(() => {
                  const eps = endpointsFor(activeWalletObj, settings);
                  return { count: bulkCount(activeWalletObj.family, settings.pageSize), seek: eps.length > 0 && eps.some(seeksByTime) };
                })()}
                onReload={() => void loadMany([activeWalletObj], 'reset')}
                onFetchMeta={fillMeta}
                onEnsure={ensureWallet}
              />
            </div>
          ) : null}
        </main>
        <BackToTop />
      </div>

      <SettingsDialog open={settingsOpen} onClose={closeDialog} />
      <ImportDialog open={importing} onClose={closeDialog} />
      <VerifyDialog
        open={verifyOpen}
        initial={share}
        onClose={() => {
          setVerifyOpen(false);
          if (share) navigate('', true);
        }}
        seen={(h) => rows.some((r) => r.hash === h)}
      />
      <DetailPanel row={selected} wallets={wallets} chains={chains} settings={settings} onClose={closeDetail} />
    </>
  );
}
