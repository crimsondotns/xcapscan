/** แผงขวา — รายละเอียดธุรกรรมโครงเดียวกับหน้าอ้างอิง: หัว (ชนิด/เวลา/สถานะ) → สินทรัพย์ → แถวข้อมูล */
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { useI18n } from '../i18n';
import type { Move, TxRow } from '../feed';
import type { Settings, Wallet } from '../store';
import { chainOf, type ChainMap } from '../chains';
import { REFRESH_MS, priceOf, refreshPrice, usdOf } from '../prices';
import { formatPrice, formatAmount, formatAmountFull, formatAmountShort, formatFeeNative, formatFeeUsd, formatStamp, formatUsd, formatUsdExact, shortAddr, shortHash } from '../format';
import { Icon } from './Icon';
import { Logo } from './Logo';
import { Identicon } from './Identicon';
import { useToast } from './Toast';
import { slipData, type SlipData } from '../slip';
import { SlipLightbox } from './SlipView';
import { protocolKind } from '../kind';
import { riskReasons } from '../risk';

export function DetailPanel({ row, wallets, chains, settings, onClose }: { row: TxRow | null; wallets: Wallet[]; chains: ChainMap; settings: Settings; onClose: () => void }) {
  /* สลิป: กดปุ่ม Slip → เปิดภาพสลิปแบบ lightbox ทับทุกอย่าง (ไม่ใช่ไดอะล็อก) — เปลี่ยนแถว/ปิดแผงแล้วรีเซ็ต */
  const [slip, setSlip] = useState<SlipData | null>(null);
  useEffect(() => setSlip(null), [row]);
  const { t } = useI18n();
  const { toast } = useToast();
  /* คลิกตัวเลข → คัดลอกค่าเต็มความละเอียด (ไม่ใช่ที่แสดง) */
  async function copyValue(v: string) {
    try {
      await navigator.clipboard.writeText(v);
      toast(t('tx.copied'));
    } catch {
      /* clipboard ถูกบล็อก */
    }
  }
  const closeBtn = useRef<HTMLButtonElement>(null);
  const [, setTick] = useState(0);
  /* ราคาเป็น USD ของโทเคนในธุรกรรมนี้ — ใช้แคชก่อน แล้วดึงใหม่จาก URL ราคา (ถ้าตั้ง) ทุก 5 นาทีระหว่างเปิดแผง */
  useEffect(() => {
    if (!row) return;
    const template = settings.priceUrl;
    const tokens = [...row.moves.map((m) => ({ tokenId: m.tokenId, symbol: m.symbol })), { tokenId: null, symbol: row.nativeSymbol ?? '' }];
    let alive = true;
    const run = () => void Promise.all(tokens.map((x) => refreshPrice(template, row.chain, x.tokenId, x.symbol))).then(() => alive && setTick((n) => n + 1));
    run();
    const id = setInterval(run, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [row, settings.priceUrl]);

  useEffect(() => {
    if (!row) return;
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [row, onClose]);

  if (!row) return null;
  const wallet = wallets.find((w) => w.id === row.walletId);
  const chain = chainOf(chains, row.chain);
  const chainLogo = chain?.logo ?? row.chainLogo ?? null;
  const chainName = chain?.name ?? row.chain;
  const native = row.nativeSymbol ?? chain?.symbol ?? row.chain.toUpperCase();
  const kind = protocolKind(row);
  /* ลิงก์ explorer: จาก chain list ก่อน ไม่มีค่อยดูว่าแหล่งข้อมูลแนบ URL มากับแถวไหม; ไม่มีทั้งคู่ → ปุ่มปิด (ไม่ซ่อน) */
  const rawUrl = ['tx_url', 'explorer_url', 'url', 'link'].map((k) => row.raw[k]).find((v): v is string => typeof v === 'string' && /^https:\/\//i.test(v)) ?? null;
  // explorer จาก chain list / Custom chains: รับทั้ง host เปล่า และที่วางมาพร้อม /tx/ ท้าย → ลิงก์ = host/tx/<hash|signature>
  const host = chain?.explorer?.replace(/\/+$/, '').replace(/\/tx$/i, '') ?? (rawUrl ? new URL(rawUrl).origin : null);
  const txUrl = chain?.explorer ? `${host}/tx/${row.hash}` : rawUrl;
  const explorerName = host ? host.replace(/^https?:\/\/(www\.)?/, '') : '';

  const real = row.moves.filter((m) => m.amount !== 0);
  const ins = real.filter((m) => m.dir === 'in');
  const outs = real.filter((m) => m.dir === 'out');
  const isSwap = ins.length > 0 && outs.length > 0;
  // อัตราแลกเปลี่ยนแสดงเป็น USD ต่อ 1 หน่วยของแต่ละโทเคนในธุรกรรม (ไม่แสดงสัดส่วนโทเคนต่อโทเคน)
  const rateRows = real
    .filter((m, i, arr) => arr.findIndex((y) => y.symbol === m.symbol) === i)
    .map((m) => ({ symbol: m.symbol, price: priceOf(row.chain, m.tokenId, m.symbol) ?? m.price }))
    .filter((x): x is { symbol: string; price: number } => x.price !== null && x.price > 0)
    .map((x) => ({ symbol: x.symbol, price: Number(x.price.toPrecision(12)) }));
  const single = real[0] ?? row.moves[0] ?? null;
  // ค่าใช้จ่ายของสวอป: มูลค่าที่ส่งออก − มูลค่าที่ได้รับ (ค่าธรรมเนียมสวอป/slippage/ราคาขยับ) แยกจากค่าเครือข่าย
  // มูลค่า USD ของแต่ละขา: ที่แหล่งให้มาก่อน ไม่มีค่อยใช้ราคาล่าสุดจากแคช (ไม่ยิงขอราคาแยก)
  const moveUsd = (m: Move) => usdOf(m.amount, m.usd, row.chain, m.tokenId, m.symbol);
  const sumUsd = (ms: Move[]) => (ms.every((m) => moveUsd(m) !== null) ? ms.reduce((a, m) => a + (moveUsd(m) ?? 0), 0) : null);
  const sentUsd = isSwap ? sumUsd(outs) : null;
  const recvUsd = isSwap ? sumUsd(ins) : null;
  const swapCost = sentUsd !== null && recvUsd !== null ? sentUsd - recvUsd : null;
  const gasUsd = row.gasNative !== null ? usdOf(row.gasNative, row.gasUsd, row.chain, null, native) : row.gasUsd;
  const totalCost = swapCost !== null ? swapCost + (gasUsd ?? 0) : gasUsd;

  /* แถวสินทรัพย์: [โลโก้] สัญลักษณ์ + (◈ on เชน) ซ้าย, จำนวน + USD ขวา */
  const Asset = ({ m }: { m: Move }) => (
    <div className="ev-asset">
      <span className="ev-asset-icon">
        {/* เหรียญพื้นเมือง (ไม่มี tokenId) ไม่มีโลโก้ของตัวเอง → ใช้โลโก้เชน */}
        <Logo src={m.logo ?? (m.tokenId === null ? chainLogo : null)} name={m.symbol} size={40} />
        <span className="logo-badge">
          <Logo src={chainLogo} name={row.chain} size={16} />
        </span>
      </span>
      <span className="ev-asset-info">
        {m.tokenId ? (
          <button
            type="button"
            className="ev-symbol copy-name"
            title={t('token.copyAddress', { sym: m.symbol })}
            aria-label={t('token.copyAddress', { sym: m.symbol })}
            onClick={() => void copyValue(m.tokenId ?? '')}
          >
            {m.symbol}
          </button>
        ) : (
          <span className="ev-symbol" title={t('token.native')}>
            {m.symbol}
          </span>
        )}
        <span className="ev-net">{t('detail.on', { chain: chainName })}</span>
      </span>
      <span className="ev-amount-wrap">
        <button
          type="button"
          className="ev-amount copyable-number"
          data-dir={m.approve ? 'approve' : m.dir}
          data-value={String(m.amount)}
          title={`${m.approve ? '' : m.dir === 'in' ? '+' : '−'}${formatAmountFull(m.amount)} ${m.symbol}`}
          aria-label={t('tx.copy', { what: `${formatAmountFull(m.amount)} ${m.symbol}` })}
          onClick={(e) => void copyValue(e.currentTarget.dataset.value ?? '')}
        >
          {m.approve ? '' : m.dir === 'in' ? '+' : '−'}
          {formatAmountShort(m.amount)}
        </button>
        {m.approve ? <span className="ev-amount-usd">{t('detail.allowance')}</span> : moveUsd(m) !== null && <span className="ev-amount-usd">{formatUsdExact(moveUsd(m) as number)}</span>}
      </span>
    </div>
  );

  const Row = ({ label, children }: { label: ReactNode; children: ReactNode }) => (
    <div className="ev-row">
      <span className="ev-label">{label}</span>
      <span className="ev-value">{children}</span>
    </div>
  );

  const known = (a: string) => wallets.find((w) => w.address.toLowerCase() === a.toLowerCase())?.label;
  const AddrRow = ({ label, addr, short }: { label: ReactNode; addr: string; short?: ReactNode }) => {
    short ??= known(addr);
    return (
      <Row label={label}>
        <button type="button" className="copyable-number mono ev-copy" title={addr} aria-label={t('tx.copy', { what: String(label) })} onClick={() => void copyValue(addr)}>
          {short ?? shortAddr(addr)}
        </button>
      </Row>
    );
  };

  return (
    <aside className="drawer" role="dialog" aria-modal="false" aria-labelledby="dt-h">
      <div className="drawer-head">
        <div className="ev-head">
          <h2 id="dt-h" className="ev-title">
            {t(`tx.type.${row.type}`)}
            {row.flagged && (
              <span className="flag" title={t('tx.scam')}>
                <Icon name="alert" width={12} height={12} style={{ verticalAlign: '-1px' }} />
              </span>
            )}
          </h2>
          <span className="ev-sub">
            <span>{formatStamp(row.time)}</span>
            <span className="ev-status" data-failed={row.failed}>
              <Icon name={row.failed ? 'x' : 'check'} />
              {row.failed ? t('tx.failed') : t('detail.executed')}
            </span>
          </span>
        </div>
        <button ref={closeBtn} type="button" className="btn btn-icon" onClick={onClose} aria-label={t('dialog.close')}>
          <Icon name="x" />
        </button>
      </div>

      <div className="drawer-body">
        {isSwap ? (
          <div className="ev-pair">
            <Asset m={outs[0]!} />
            <div className="ev-divider">
              <span className="ev-divider-icon">
                <Icon name="swap" />
              </span>
            </div>
            <Asset m={ins[0]!} />
          </div>
        ) : single ? (
          <Asset m={single} />
        ) : null}

        <div className="ev-rows">
          {wallet && (
            <AddrRow
              label={t('tx.col.wallet')}
              addr={wallet.address}
              short={
                <span className="with-logo">
                  <Identicon value={wallet.address} size={20} />
                  {wallet.label}
                </span>
              }
            />
          )}
          {rateRows.map((x) => (
            <Row key={x.symbol} label={t('detail.rate', { symbol: x.symbol })}>
              <button
                type="button"
                className="copyable-number copyable-price"
                data-value={String(x.price)}
                title={String(x.price)}
                aria-label={t('tx.copy', { what: String(x.price) })}
                onClick={(e) => void copyValue(e.currentTarget.dataset.value ?? '')}
              >
                {formatPrice(x.price)}
              </button>
            </Row>
          ))}
          {!isSwap && row.from && <AddrRow label={t('detail.from')} addr={row.from} />}
          {!isSwap && row.to && <AddrRow label={t('detail.to')} addr={row.to} />}
          {/* ป้ายเป็นชนิดที่เดาได้ (Bridge / Aggregator / DEX …) ไม่งั้นค่อยเป็น Protocol */}
          {row.counterpartyName && <Row label={kind ? t(`kind.${kind}`) : t('detail.protocol')}>{row.counterpartyName}</Row>}
          {row.contract && <AddrRow label={t('detail.contract')} addr={row.contract} />}
          {row.name && row.type !== 'swap' && row.name !== row.counterpartyName && (
            <Row label={t('detail.method')}>
              <span className="mono">{row.name}</span>
            </Row>
          )}
          <Row label={t('tx.col.hash')}>
            <button type="button" className="copyable-number mono ev-copy" title={row.hash} aria-label={t('tx.copy', { what: t('tx.col.hash') })} onClick={() => void copyValue(row.hash)}>
              {shortHash(row.hash)}
            </button>
          </Row>
          {row.nonce !== null && <Row label={t('detail.nonce')}>{row.nonce}</Row>}
        </div>

        <div className="ev-rows ev-group" aria-labelledby="ev-fees">
          <div id="ev-fees" className="ev-group-title">
            {t('detail.fees')}
          </div>
          {isSwap && sentUsd !== null && <Row label={t('detail.sentValue')}>{formatUsd(sentUsd)}</Row>}
          {isSwap && recvUsd !== null && <Row label={t('detail.receivedValue')}>{formatUsd(recvUsd)}</Row>}
          <Row label={t('detail.networkFee')}>
            {row.gasNative !== null ? (
              <span>
                {formatFeeNative(row.gasNative, native)}
                {gasUsd !== null && ` (${formatFeeUsd(gasUsd)})`}
              </span>
            ) : gasUsd !== null ? (
              <span>{formatFeeUsd(gasUsd)}</span>
            ) : (
              <span className="ev-note">{t('detail.feePaidBySender')}</span>
            )}
          </Row>
          {totalCost !== null && (
            <Row label={t('detail.totalCost')}>
              <span className="ev-total">{formatUsdExact(totalCost)}</span>
            </Row>
          )}
        </div>
      </div>

      {/* ปุ่มเดียวเต็มกว้าง → เมนูลอยขึ้นด้านบน: ดูสลิป / ดูบน explorer */}
      <div className="drawer-foot">
        <ViewMenu
          label={t('detail.view')}
          items={[
            {
              key: 'slip',

              label: t('slip.open'),
              onSelect: () =>
                setSlip(
                  slipData(row, wallet, chainName, native, txUrl, {
                    chainLogo,
                    usdOfMove: moveUsd,
                    feeUsd: gasUsd,
                    protocol: row.counterpartyName,
                    protocolKind: kind ? t(`kind.${kind}`) : null,
                    reasons: riskReasons(row, wallets, t),
                    labelOf: known,
                  }),
                ),
            },
            txUrl ? { key: 'explorer', label: t('detail.viewOn', { name: explorerName }), href: txUrl } : { key: 'explorer', label: t('detail.noExplorer'), disabled: true },
          ]}
        />
      </div>
      {slip && <SlipLightbox data={slip} onClose={() => setSlip(null)} />}
    </aside>
  );
}

interface ViewItem {
  key: string;
  label: string;
  onSelect?: () => void;
  href?: string;
  disabled?: boolean;
}

/** ปุ่มเดียว + เมนูลอย (เปิดขึ้นด้านบน) — Esc/คลิกนอก ปิด, ลูกศรขึ้นลงเลื่อน, เปิดแล้วโฟกัสรายการแรก */
function ViewMenu({ label, items }: { label: string; items: ViewItem[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const focusables = () => [...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])];
  useEffect(() => {
    if (!open) return;
    focusables()[0]?.focus();
    const onDoc = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const list = focusables();
      const i = list.indexOf(document.activeElement as HTMLElement);
      list[(i + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length]?.focus();
    }
  };
  return (
    <div className="view-menu" ref={root} onKeyDown={onKey}>
      {open && (
        <div className="view-menu-panel" role="menu" id={menuId} aria-label={label}>
          {items.map((it) =>
            it.href ? (
              <a key={it.key} className="view-menu-item" role="menuitem" href={it.href} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}>
                {it.label}
              </a>
            ) : (
              <button
                key={it.key}
                type="button"
                className="view-menu-item"
                role="menuitem"
                aria-disabled={it.disabled || undefined}
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onSelect?.();
                }}
              >
                {it.label}
              </button>
            ),
          )}
        </div>
      )}
      <button ref={trigger} type="button" className="btn btn-primary" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => setOpen(!open)}>
        {label}
      </button>
    </div>
  );
}
