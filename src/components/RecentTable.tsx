import { useI18n } from '../i18n';
import type { TxRow } from '../feed';
import { useStore, type Wallet } from '../store';
import { Field, FieldLabel } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { chainOf, type ChainMap } from '../chains';
import { formatAmount, formatFeeNative, formatFeeUsd, formatRelative, shortAddr } from '../format';
import { Icon } from './Icon';
import { protocolKind } from '../kind';
import { Logo } from './Logo';
import { Identicon } from './Identicon';
import { SkeletonRows } from './Skeleton';
import { useStickyHead } from '../useStickyHead';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const LIMIT = 10;

/**
 * ธุรกรรมล่าสุด (พรีวิว) — เป็นแท็บหนึ่งในการ์ดของหน้าแรก จึงไม่มีกรอบ/หัวข้อของตัวเอง
 * เดิม: หน้า 1 ตารางที่ 2: ธุรกรรมล่าสุด (พรีวิว) จากทุกกระเป๋าที่โหลดแล้ว — Type · From · To · Submitted · Amount · Network fee
 * ขนาดคงที่ 10 แถว ไม่มีเลื่อนโหลดเพิ่ม (กัน rate limit) — ดูทั้งหมดของกระเป๋าได้ที่หน้า 2; คลิกแถว = เปิดแผงรายละเอียดขวา (แผงเดิม)
 */
export function RecentTable({ rows, wallets, chains, selected, onSelect, loading }: { rows: TxRow[]; wallets: Wallet[]; chains: ChainMap; selected: string | null; onSelect: (r: TxRow) => void; loading: boolean }) {
  const { t } = useI18n();
  const byAddr = new Map(wallets.map((w) => [w.address.toLowerCase(), w]));
  /* ซ่อน/แสดงรายการน่าสงสัย — ค่าเดียวกับแท็บธุรกรรม/โทเคน (settings.hideScam) */
  const { settings, setHideScam } = useStore();
  const recent = (settings.hideScam ? rows.filter((r) => !r.flagged) : rows).slice(0, LIMIT);
  const head = useStickyHead();

  const Party = ({ addr }: { addr: string | null }) => {
    if (!addr) return <span className="text-sm text-muted-foreground">—</span>;
    const w = byAddr.get(addr.toLowerCase());
    return w ? (
      <span className="with-logo">
        <Identicon value={w.address} size={20} />
        <span className="wt-label">{w.label}</span>
      </span>
    ) : (
      <span className="mono" title={addr}>
        {shortAddr(addr)}
      </span>
    );
  };

  return (
    <>
      <div className="toolbar">
        <Field orientation="horizontal" className="w-auto">
          <Switch id="recent-hide-scam" checked={settings.hideScam} onCheckedChange={(v) => setHideScam(v)} />
          <FieldLabel htmlFor="recent-hide-scam" className="font-normal">
            {t('tx.hideScam')}
          </FieldLabel>
        </Field>
      </div>
      {recent.length === 0 && !loading ? (
        <p className="text-sm text-muted-foreground">{t('recent.empty')}</p>
      ) : (
        <div className="table-wrap wtab-wrap">
          <Table containerClassName="lg:overflow-visible" className="tx recent">
            <TableHeader ref={head.ref} data-stuck={head.stuck}>
              <TableRow>
                <TableHead scope="col">{t('tx.col.type')}</TableHead>
                <TableHead scope="col">{t('tx.col.from')}</TableHead>
                <TableHead scope="col">{t('tx.col.to')}</TableHead>
                <TableHead scope="col" className="num">
                  {t('tx.col.submitted')}
                </TableHead>
                <TableHead scope="col" className="num">
                  {t('tx.col.amount')}
                </TableHead>
                <TableHead scope="col" className="num">
                  {t('tx.col.fee')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recent.length === 0 && loading && <SkeletonRows rows={5} cols={[120, 90, 90, 100, 110, 70]} />}
              {recent.map((r) => {
                const real = r.moves.filter((m) => m.amount !== 0);
                const ins = real.filter((m) => m.dir === 'in');
                const outs = real.filter((m) => m.dir === 'out');
                const isSwap = ins.length > 0 && outs.length > 0;
                const primary = real[0] ?? r.moves[0] ?? null;
                const chainLogo = chainOf(chains, r.chain)?.logo ?? r.chainLogo ?? null;
                // เหรียญพื้นเมือง (ไม่มี tokenId) → ใช้โลโก้เชนแทน
                const logoOf = (m: { logo: string | null; tokenId: string | null }) => m.logo ?? (m.tokenId === null ? chainLogo : null);
                const native = r.nativeSymbol ?? chainOf(chains, r.chain)?.symbol ?? r.chain.toUpperCase();
                const title = r.failed ? t('tx.failed') : t(`tx.type.${r.type}`);
                const base = isSwap ? `${outs[0]!.symbol} → ${ins[0]!.symbol}` : primary ? (primary.name ?? primary.symbol) : r.name || '';
                // ชื่อโปรโตคอล/คู่สัญญาต่อท้าย (USDC · Lifiprotocol) — ถ้ามี
                const kind = protocolKind(r);
                const proto = r.counterpartyName ? (kind ? `${t(`kind.${kind}`)} · ${r.counterpartyName}` : r.counterpartyName) : '';
                const subtitle = proto && base !== r.counterpartyName ? (base ? `${base} · ${proto}` : proto) : base;
                return (
                  <TableRow
                    key={r.key}
                    className="tx-row"
                    tabIndex={0}
                    aria-selected={r.key === selected}
                    onClick={() => onSelect(r)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelect(r);
                      }
                    }}
                  >
                    <TableCell>
                      <span className="act">
                        <span className="act-icon">
                          {isSwap ? (
                            <span className="pair">
                              <Logo src={logoOf(outs[0]!)} name={outs[0]!.symbol} size={28} />
                              <Logo src={logoOf(ins[0]!)} name={ins[0]!.symbol} size={28} />
                            </span>
                          ) : (
                            <Logo src={primary ? logoOf(primary) : null} name={primary?.symbol ?? r.chain} size={40} />
                          )}
                          <span className="logo-badge">
                            <Logo src={chainLogo} name={r.chain} size={16} />
                          </span>
                        </span>
                        <span className="act-text">
                          <span className="act-title">
                            {title}
                            {r.flagged && (
                              <span className="flag" title={t('tx.scam')}>
                                <Icon name="alert" width={12} height={12} style={{ verticalAlign: '-1px' }} />
                              </span>
                            )}
                          </span>
                          <span className="act-sub">{subtitle}</span>
                        </span>
                      </span>
                    </TableCell>
                    <TableCell>
                      <Party addr={r.from} />
                    </TableCell>
                    <TableCell>
                      <Party addr={r.to} />
                    </TableCell>
                    <TableCell className="num cell-time">{formatRelative(r.time, t)}</TableCell>
                    <TableCell className="num">
                      <span className="amts">
                        {ins.map((m, i) => (
                          <span key={`i${i}`} className="amt-in">
                            +{formatAmount(m.amount)} {m.symbol}
                          </span>
                        ))}
                        {outs.map((m, i) => (
                          <span key={`o${i}`} className="amt-out">
                            {m.approve ? '' : '−'}
                            {formatAmount(m.amount)} {m.symbol}
                          </span>
                        ))}
                        {!real.length && <span className="amt-out">—</span>}
                      </span>
                    </TableCell>
                    <TableCell className="num">
                      <span className="fee">
                        {r.gasUsd !== null || r.gasNative !== null ? (
                          <>
                            <span>{r.gasUsd !== null ? formatFeeUsd(r.gasUsd) : formatFeeNative(r.gasNative, native)}</span>
                            {r.gasUsd !== null && r.gasNative !== null && <small>{formatFeeNative(r.gasNative, native)}</small>}
                          </>
                        ) : (
                          <span className="amt-out">—</span>
                        )}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
