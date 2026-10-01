/**
 * ค้นหาทั้งเว็บจากหัวเว็บ — กระเป๋า (ชื่อ/ที่อยู่) · โทเคน (สัญลักษณ์/ชื่อ) · ธุรกรรม (hash)
 * ค้นจากข้อมูลที่โหลดมาแล้วในเครื่องเท่านั้น ไม่ยิงคำขอใหม่
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useI18n } from '../i18n';
import type { Wallet } from '../store';
import type { TxRow } from '../feed';
import { shortAddr, shortHash } from '../format';
import { tokenSummary } from '../flow';
import { chainOf, type ChainInfo, type ChainMap } from '../chains';
import { SearchIcon } from 'lucide-react';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';

export interface Hit {
  key: string;
  kind: 'wallet' | 'token' | 'tx';
  label: string;
  sub: string;
  /** เชนที่โหลดแล้วของกระเป๋านั้น — แสดงเป็นโลโก้เชนทางขวา */
  chains?: string[];
  /** ตระกูลเชนของกระเป๋า (sol / erc20) — ใช้แสดง fallback เมื่อยังไม่มีธุรกรรม */
  family?: string;
  go: () => void;
}

const LIMIT = { wallet: 5, token: 4, tx: 3 };
const MAX_MARKS = 4;

/** ชุด chain เริ่มต้นต่อตระกูล — โชว์ตอนยังไม่โหลดว่า wallet นี้อยู่บนเครือข่ายอะไรได้บ้าง */
const DEFAULT_CHAINS: Record<string, string[]> = {
  erc20: ['eth', 'arb', 'base', 'op', 'bsc'],
  sol: ['sol'],
};

/** โลโก้เชนของกระเป๋า — ของจริงจากธุรกรรมที่โหลดแล้ว; ยังไม่โหลด → ชุด chain ของตระกูลนั้น */
function WalletMarks({ family, chainIds, chains }: { family: string; chainIds: string[]; chains: ChainMap }) {
  // โหลดแล้ว → โลโก้เชนจริงจากธุรกรรม
  if (chainIds.length) {
    return (
      <span className="chain-marks">
        {chainIds.slice(0, MAX_MARKS).map((id) => {
          const c = chainOf(chains, id);
          if (!c?.logo) return null;
          return <img key={id} className="logo" src={c.logo} alt={c.name ?? id} width={18} height={18} loading="lazy" decoding="async" referrerPolicy="no-referrer" style={{ width: 18, height: 18 }} />;
        })}
      </span>
    );
  }

  // ยังไม่โหลด → แสดงชุด chain เริ่มต้นของตระกูลนั้น
  const defaults = DEFAULT_CHAINS[family] ?? [];
  const infos = defaults.map((id) => chainOf(chains, id)).filter((c): c is ChainInfo => !!c?.logo);
  if (infos.length) {
    return (
      <span className="chain-marks">
        {infos.slice(0, MAX_MARKS).map((c) => (
          <img key={c.id} className="logo" src={c.logo!} alt={c.name} width={18} height={18} loading="lazy" decoding="async" referrerPolicy="no-referrer" style={{ width: 18, height: 18 }} />
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
        verticalAlign: 'middle',
        background: isSol ? 'linear-gradient(135deg, #9945FF 0%, #14F195 100%)' : '#627EEA',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.15)',
      }}
    />
  );
}

export function Finder({ wallets, rows, chains, onWallet, onToken }: { wallets: Wallet[]; rows: TxRow[]; chains: ChainMap; onWallet: (id: string) => void; onToken: (symbol: string, walletId: string | null) => void }) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();

  /** wallet id → chain ids ที่โหลดแล้ว (ไม่ซ้ำ) — เตรียมล่วงหน้าเพื่อไม่ให้ loop ซ้ำตอน render */
  const chainsByWallet = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const r of rows) {
      const list = m.get(r.walletId);
      if (!list) m.set(r.walletId, [r.chain]);
      else if (!list.includes(r.chain)) list.push(r.chain);
    }
    return m;
  }, [rows]);

  const hits = useMemo<Hit[]>(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    const out: Hit[] = [];
    for (const w of wallets) {
      if (out.length >= LIMIT.wallet) break;
      if (w.label.toLowerCase().includes(needle) || w.address.toLowerCase().includes(needle))
        out.push({
          key: `w:${w.id}`,
          kind: 'wallet',
          label: w.label || shortAddr(w.address),
          sub: shortAddr(w.address),
          chains: chainsByWallet.get(w.id) ?? [],
          family: w.family,
          go: () => onWallet(w.id),
        });
    }
    const tokens = tokenSummary(rows).filter((k) => k.symbol.toLowerCase().includes(needle) || (k.name ?? '').toLowerCase().includes(needle));
    for (const k of tokens.slice(0, LIMIT.token)) out.push({ key: `t:${k.symbol}`, kind: 'token', label: k.symbol, sub: k.name ?? k.chain, go: () => onToken(k.symbol, null) });
    const txs = rows.filter((r) => r.hash.toLowerCase().includes(needle)).slice(0, LIMIT.tx);
    for (const r of txs) {
      const w = wallets.find((x) => x.id === r.walletId);
      out.push({ key: `x:${r.key}`, kind: 'tx', label: shortHash(r.hash), sub: `${t(`tx.type.${r.type}`)} · ${w?.label ?? shortAddr(r.walletId)}`, go: () => onWallet(r.walletId) });
    }
    return out;
  }, [q, wallets, rows, chainsByWallet, onWallet, onToken, t]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  function pick(h: Hit | undefined) {
    if (!h) return;
    h.go();
    setQ('');
    setOpen(false);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!hits.length) return;
      setOpen(true);
      setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length);
    } else if (e.key === 'Enter') {
      if (open && hits.length) {
        e.preventDefault();
        pick(hits[active]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  const shown = open && q.trim() !== '';
  return (
    <div className="finder" ref={root}>
      <label className="sr-only" htmlFor="finder">
        {t('find.label')}
      </label>
      <InputGroup className="w-full sm:w-64 lg:w-72">
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
        id="finder"
        name="find"
        type="search"
        placeholder={t('find.placeholder')}
        value={q}
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-expanded={shown}
        aria-controls={shown ? listId : undefined}
        aria-autocomplete="list"
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        />
      </InputGroup>
      {shown && (
        <div className="results" id={listId} role="listbox" aria-label={t('find.label')}>
          {hits.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('find.empty')}</p>
          ) : (
            hits.map((h, i) => (
              <button key={h.key} type="button" role="option" aria-selected={i === active} data-active={i === active} onMouseEnter={() => setActive(i)} onClick={() => pick(h)}>
                <span className="act-text">
                  <span className="act-title">{h.label}</span>
                  <span className="act-sub">{h.sub}</span>
                </span>
                {h.kind === 'wallet' && h.family ? (
                  <span className="kind">
                    <WalletMarks family={h.family} chainIds={h.chains ?? []} chains={chains} />
                  </span>
                ) : (
                  <span className="kind">{t(`find.${h.kind}`)}</span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}