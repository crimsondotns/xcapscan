/**
 * กราฟพื้นที่ซ้อน เงินเข้า/เงินออก รายวัน — วาดเอง ไม่มีไลบรารีกราฟ
 * เส้นกริดแนวนอน · แกนวันที่ · ชี้แล้วมีป้ายบอกค่าของวันนั้น · คำอธิบายสีใต้กราฟ
 * ความสูงของกองรวม = เงินที่เคลื่อนทั้งหมดของวันนั้น (เข้า + ออก)
 */
import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { daily, signClassOf } from '../flow';
import { areaPath, bandPath, nearestIndex, niceMax, smoothPath, tickIndexes, type Pt } from '../chart';
import type { TxRow } from '../feed';
import { useI18n } from '../i18n';
import { formatDayShort, formatUsdCompact, formatUsdExact } from '../format';
import { SkeletonBar, SkeletonBlock } from './Skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

export const RANGES = [7, 30, 90] as const;
export type Range = (typeof RANGES)[number];

export function RangeChips({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  const { t } = useI18n();
  return (
    <ToggleGroup variant="outline" size="sm" value={[String(value)]} onValueChange={(v: string[]) => v[0] && onChange(Number(v[0]) as Range)} aria-label={t('flow.rangeLabel')}>
      {RANGES.map((r) => (
        <ToggleGroupItem key={r} value={String(r)}>
          {t('flow.range', { n: r })}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

const PAD = { top: 10, right: 8, bottom: 26, left: 8 };
const GRID = 4;

export function FlowChart({ rows, days, height = 250, loading = false }: { rows: TxRow[]; days: number; height?: number; loading?: boolean }) {
  const { t } = useI18n();
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [hover, setHover] = useState<number | null>(null);

  /* กว้างเท่าที่การ์ดให้มาจริง — วาดด้วยพิกเซลจริง ตัวอักษรและเส้นจึงคมและจับตำแหน่งเมาส์ได้ตรง
     วัดก่อนเฟรมแรกจะถูกวาด (layout effect) ไม่งั้นจะเห็นกราฟความกว้างมั่วแวบหนึ่ง */
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    if (el.clientWidth > 0) setWidth(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => {
      const w = entry?.contentRect.width ?? 0;
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const points = useMemo(() => daily(rows, days), [rows, days]);
  /* ยังไม่มีข้อมูลเลยและกำลังโหลดอยู่ → โครงร่างสูงเท่ากราฟจริง หน้าจึงไม่กระตุกตอนข้อมูลมา */
  const pending = loading && rows.length === 0;
  const plot = { left: PAD.left, right: Math.max(PAD.left + 1, width - PAD.right), top: PAD.top, bottom: height - PAD.bottom };
  const max = useMemo(() => niceMax(Math.max(...points.map((p) => p.inUsd + p.outUsd), 0)), [points]);
  const x = (i: number) => plot.left + (i * (plot.right - plot.left)) / Math.max(1, days - 1);
  const y = (v: number) => plot.bottom - (v / max) * (plot.bottom - plot.top);
  const outLine: Pt[] = points.map((p, i) => ({ x: x(i), y: y(p.outUsd) }));
  const topLine: Pt[] = points.map((p, i) => ({ x: x(i), y: y(p.outUsd + p.inUsd) }));
  const ticks = tickIndexes(days, plot.right - plot.left);
  const net = points.reduce((s, p) => s + p.inUsd - p.outUsd, 0);
  const active = hover === null ? null : (points[hover] ?? null);

  function onMove(e: PointerEvent<SVGRectElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    setHover(nearestIndex(e.clientX - box.left + plot.left, plot.left, plot.right, days));
  }

  if (pending) {
    return (
      <figure className="chart" ref={wrap}>
        <SkeletonBlock height={height} />
      </figure>
    );
  }
  return (
    <figure className="chart" ref={wrap}>
      <div className="chart-plot">
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${t('flow.chart')} · ${t('token.net')} ${formatUsdExact(net)}`}>
          {Array.from({ length: GRID + 1 }, (_, i) => {
            const gy = plot.top + (i * (plot.bottom - plot.top)) / GRID;
            return <line key={i} className="grid" x1={plot.left} x2={plot.right} y1={gy} y2={gy} />;
          })}
          <path className="area-out" d={areaPath(outLine, plot.bottom)} />
          <path className="area-in" d={bandPath(topLine, outLine)} />
          <path className="line-out" d={smoothPath(outLine)} />
          <path className="line-in" d={smoothPath(topLine)} />
          {ticks.map((i) => (
            <text key={i} className="axis" x={x(i)} y={height - 8} textAnchor={i === 0 ? 'start' : i === days - 1 ? 'end' : 'middle'}>
              {formatDayShort(points[i]?.at ?? 0)}
            </text>
          ))}
          {hover !== null && active && (
            <>
              <circle className="dot dot-out" cx={x(hover)} cy={y(active.outUsd)} r={3.5} />
              <circle className="dot dot-in" cx={x(hover)} cy={y(active.outUsd + active.inUsd)} r={3.5} />
            </>
          )}
          {/* พื้นที่รับเมาส์ — ใสทั้งแผ่น ไม่มีเส้น cursor ตามตัวอย่าง */}
          <rect x={plot.left} y={plot.top} width={plot.right - plot.left} height={plot.bottom - plot.top} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
        </svg>
        {hover !== null && active && (
          <div className="chart-tip" style={{ left: `${Math.min(Math.max(x(hover), 76), Math.max(76, width - 76))}px`, top: `${Math.max(plot.top, y(active.outUsd + active.inUsd) - 12)}px` }} role="status">
            <span className="chart-tip-date">{formatDayShort(active.at)}</span>
            <span className="chart-tip-row">
              <span className="chart-dot dot-in" aria-hidden="true" />
              {t('flow.in')}
              <b>{formatUsdCompact(active.inUsd)}</b>
            </span>
            <span className="chart-tip-row">
              <span className="chart-dot dot-out" aria-hidden="true" />
              {t('flow.out')}
              <b>{formatUsdCompact(active.outUsd)}</b>
            </span>
            <span className="chart-tip-row chart-tip-net">
              {t('token.net')}
              <b className={signClassOf(active.inUsd - active.outUsd)}>{formatUsdCompact(active.inUsd - active.outUsd)}</b>
            </span>
          </div>
        )}
      </div>
      <figcaption className="chart-legend">
        <span>
          <span className="chart-dot dot-in" aria-hidden="true" />
          {t('flow.in')}
        </span>
        <span>
          <span className="chart-dot dot-out" aria-hidden="true" />
          {t('flow.out')}
        </span>
      </figcaption>
    </figure>
  );
}

/** ช่องสรุปสี่ช่องใต้กราฟ — ค่าที่สองบรรทัดล่างเป็นบริบท ไม่ใช่ตัวเลขหลัก */
export function Stat({ label, value, tone, sub, loading = false }: { label: string; value: string; tone?: string; sub?: string; loading?: boolean }) {
  return (
    <div className="stat">
      <span className="text-sm text-muted-foreground">{label}</span>
      {loading ? (
        <b>
          <SkeletonBar width={96} height={18} />
        </b>
      ) : (
        <b className={tone}>{value}</b>
      )}
      {sub !== undefined && <span className="text-sm text-muted-foreground">{loading ? <SkeletonBar width={64} /> : sub}</span>}
    </div>
  );
}
