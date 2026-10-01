/** แผงขวา — รายละเอียดธุรกรรมโครงเดียวกับหน้าอ้างอิง: หัว (ชนิด/เวลา/สถานะ) → สินทรัพย์ → แถวข้อมูล */
import { useEffect, useState, type ReactNode } from 'react';
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
import { CheckIcon, ChevronUpIcon, ExternalLinkIcon, TriangleAlertIcon, XIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/useIsMobile';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';

type PanelProps = { row: TxRow | null; wallets: Wallet[]; chains: ChainMap; settings: Settings; onClose: () => void };

/** แผงขวา = shadcn Sheet (มือถือ: เต็มจอจากด้านล่าง); โฟกัส/Esc/ม่าน/inert มาจาก Base UI — ตารางข้างหลังไม่ขยับ */
export function DetailPanel(props: PanelProps) {
  const mobile = useIsMobile();
  /* เก็บแถวล่าสุดไว้ระหว่างแอนิเมชันปิด จะได้ไม่วูบเป็นแผงว่าง */
  const [last, setLast] = useState<TxRow | null>(props.row);
  if (props.row && props.row !== last) setLast(props.row);
  const row = props.row ?? last;
  return (
    <Sheet open={props.row !== null} onOpenChange={(o) => !o && props.onClose()}>
      <SheetContent side={mobile ? 'bottom' : 'right'} className={cn('gap-0', mobile ? 'h-dvh' : 'w-full sm:max-w-[440px]')}>
        {row && <DetailBody {...props} row={row} />}
      </SheetContent>
    </Sheet>
  );
}

function DetailBody({ row, wallets, chains, settings }: PanelProps & { row: TxRow }) {
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
    <>
      <SheetHeader className="border-b pr-12">
        <SheetTitle className="flex items-center gap-2 text-lg">
          {t(`tx.type.${row.type}`)}
          {row.flagged && (
            <Badge variant="destructive" title={t('tx.scam')}>
              <TriangleAlertIcon data-icon="inline-start" />
              {t('tx.scam')}
            </Badge>
          )}
        </SheetTitle>
        <SheetDescription className="flex flex-wrap items-center gap-2">
          <span>{formatStamp(row.time)}</span>
          <Badge variant={row.failed ? 'destructive' : 'secondary'}>
            {row.failed ? <XIcon data-icon="inline-start" /> : <CheckIcon data-icon="inline-start" />}
            {row.failed ? t('tx.failed') : t('detail.executed')}
          </Badge>
        </SheetDescription>
      </SheetHeader>

      <div className="drawer-body flex-1 overflow-y-auto overscroll-contain">
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
      <SheetFooter className="border-t">
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
      </SheetFooter>
      <SlipLightbox data={slip} onClose={() => setSlip(null)} />
    </>
  );
}

interface ViewItem {
  key: string;
  label: string;
  onSelect?: () => void;
  href?: string;
  disabled?: boolean;
}

/** ปุ่มเดียวเต็มกว้าง + shadcn DropdownMenu เปิดขึ้นด้านบน: ดูสลิป / ดูบน explorer */
function ViewMenu({ label, items }: { label: string; items: ViewItem[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="lg" className="w-full" />}>
        {label}
        <ChevronUpIcon data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="center" className="w-(--anchor-width)">
        <DropdownMenuGroup>
          {items.map((it) =>
            it.href ? (
              <DropdownMenuItem key={it.key} render={<a href={it.href} target="_blank" rel="noopener noreferrer" />}>
                {it.label}
                <ExternalLinkIcon className="ml-auto" />
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem key={it.key} disabled={it.disabled} onClick={() => it.onSelect?.()}>
                {it.label}
              </DropdownMenuItem>
            ),
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
