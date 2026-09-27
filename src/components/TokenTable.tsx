/** สรุปรายโทเคนของกระเป๋า — คลิกแถวเพื่อไปหน้าโทเคนนั้น */
import { useMemo } from 'react';
import type { TxRow } from '../feed';
import { tokenSummary, signClassOf } from '../flow';
import { formatUsdExact } from '../format';
import { useI18n } from '../i18n';
import { useCopy } from '../copy';
import { TokenLogo } from './Logo';
import { chainOf, type ChainMap } from '../chains';
import { Icon } from './Icon';
import { useStickyHead } from '../useStickyHead';
import { SkeletonRows } from './Skeleton';
import { useStore } from '../store';

export function TokenTable({ rows, chains, onToken, loading = false }: { rows: TxRow[]; chains: ChainMap; onToken: (symbol: string) => void; loading?: boolean }) {
  const { t } = useI18n();
  const copy = useCopy();
  /* ซ่อน/แสดงโทเคนน่าสงสัย — ใช้ค่าเดียวกับแท็บธุรกรรม (settings.hideScam) */
  const { settings, setHideScam } = useStore();
  const hideScam = settings.hideScam;
  const all = useMemo(() => tokenSummary(rows), [rows]);
  /* โลโก้เชน: chain list ก่อน แล้วค่อยโลโก้ที่แหล่งข้อมูลแนบมากับแถว — ไม่มีทั้งคู่ = ตัวอักษร */
  const feedChainLogo = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) if (r.chainLogo && !m.has(r.chain)) m.set(r.chain, r.chainLogo);
    return m;
  }, [rows]);
  const tokens = useMemo(() => (hideScam ? all.filter((k) => !k.flagged) : all), [all, hideScam]);
  const head = useStickyHead();
  if (!all.length && !loading) return <p className="hint">{t('tx.emptyLoaded')}</p>;
  return (
    <>
      <div className="toolbar">
        {/* ป้ายกดแล้วสลับได้เหมือนกัน — label ที่ผูกกับปุ่ม (ไม่ใช่ input) ไม่ส่งคลิกต่อเอง จึงต้องสลับให้ตรงนี้ */}
        <span className="switch-field">
          <button type="button" className="switch" role="switch" aria-checked={hideScam} id="token-hide-scam" aria-label={t('tx.hideScam')} onClick={() => setHideScam(!hideScam)} />
          <label
            htmlFor="token-hide-scam"
            onClick={(e) => {
              e.preventDefault();
              setHideScam(!hideScam);
            }}
          >
            {t('tx.hideScam')}
          </label>
        </span>
        <span className="count" aria-live="polite">
          {t('token.count', { n: tokens.length })}
        </span>
      </div>
      {tokens.length === 0 && !loading ? (
        <div className="empty">
          <p>{t('tx.emptyFiltered')}</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="tx">
            <thead ref={head.ref} data-stuck={head.stuck}>
              <tr>
                <th scope="col">{t('tab.tokens')}</th>
                <th scope="col" className="num">
                  {t('flow.in')}
                </th>
                <th scope="col" className="num">
                  {t('flow.out')}
                </th>
                <th scope="col" className="num">
                  {t('token.net')}
                </th>
                <th scope="col" className="num">
                  {t('token.times')}
                </th>
              </tr>
            </thead>
            <tbody>
              {tokens.length === 0 && loading && <SkeletonRows rows={5} cols={[150, 90, 90, 90, 50]} />}
              {tokens.map((k) => (
                <tr
                  key={k.symbol}
                  className="tx-row"
                  tabIndex={0}
                  onClick={() => onToken(k.symbol)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onToken(k.symbol);
                    }
                  }}
                >
                  <td>
                    <span className="who">
                      <TokenLogo token={k.logo} tokenName={k.symbol} chain={chainOf(chains, k.chain)?.logo ?? feedChainLogo.get(k.chain) ?? null} chainName={chainOf(chains, k.chain)?.name ?? k.chain} size={28} />
                      <span className="act-text">
                        {k.tokenId ? (
                          <button
                            type="button"
                            className="act-title copy-name"
                            title={t('token.copyAddress', { sym: k.symbol })}
                            aria-label={t('token.copyAddress', { sym: k.symbol })}
                            onClick={(e) => {
                              e.stopPropagation();
                              copy(k.tokenId ?? '');
                            }}
                          >
                            {k.symbol}
                          </button>
                        ) : (
                          <span className="act-title" title={t('token.native')}>
                            {k.symbol}
                          </span>
                        )}
                        <span className="act-sub">
                          {k.flagged && (
                            <span className="flag" title={t('tx.scam')}>
                              <Icon name="alert" width={12} height={12} style={{ verticalAlign: '-1px' }} />
                            </span>
                          )}
                          {k.name ?? k.chain}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className="num">{formatUsdExact(k.inUsd)}</td>
                  <td className="num">{formatUsdExact(k.outUsd)}</td>
                  <td className="num">
                    <span className={signClassOf(k.inUsd - k.outUsd)}>{formatUsdExact(k.inUsd - k.outUsd)}</span>
                  </td>
                  <td className="num">{k.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
