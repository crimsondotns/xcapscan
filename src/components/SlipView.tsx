/** สลิปธุรกรรม — เปิดภาพแบบ lightbox (ม่านมืด + ภาพกลาง + ปิดมุมขวาบน) ไม่ใช่ไดอะล็อก ไม่มีแถบปุ่ม — ผู้ใช้คลิกขวา/ลากภาพเซฟเองแบบรูปทั่วไป */
import { useEffect, useRef, useState } from 'react';
import { useModalLayer } from '../modal';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n';
import { useStore } from '../store';
import { canvasBlob, renderSlip, saveSlip, slipCode, type SlipAction, type SlipData, type SlipImage, type SlipRecord } from '../slip';
import { Icon } from './Icon';

export function useSlipLabels() {
  const { t } = useI18n();
  return (d: SlipData) => ({
    title: t('slip.title'),
    on: t('slip.on'),
    action: { download: t('slip.did.download'), copy: t('slip.did.copy'), print: t('slip.did.print'), share: t('slip.did.share'), verify: t('slip.did.verify') },
    wallet: t('tx.col.wallet'),
    from: t('detail.from'),
    to: t('detail.to'),
    hash: t('tx.col.hash'),
    fee: t('detail.networkFee'),
    time: t('tx.col.time'),
    chain: t('tx.col.chain'),
    code: t('slip.code'),
    issued: t('slip.issued'),
    type: t(`tx.type.${d.type}` as 'tx.type.send'),
    status: t('detail.status'),
    statusOk: t('detail.executed'),
    statusFailed: t('tx.failed'),
    success: t('slip.success'),
    failed: t('slip.failedTitle'),
    received: t('slip.received'),
    sent: t('slip.sent'),
    approved: t('slip.approved'),
    flaggedTitle: t('slip.flaggedTitle'),
    why: t('slip.why'),
    verifyFirst: t('slip.verifyFirst'),
    protocol: t('detail.protocol'),
  });
}

/** วาดสลิปเป็นภาพ (blob URL — เมนูคลิกขวาของเบราว์เซอร์คัดลอก/เซฟรูปได้จริง ต่างจาก data URL ยาวๆ) */
export function useSlipImage(rec: SlipRecord | null, action: SlipAction | null = null) {
  const labels = useSlipLabels();
  const { settings } = useStore();
  const [img, setImg] = useState<(SlipImage & { url: string }) | null>(null);
  useEffect(() => {
    if (!rec) return setImg(null);
    let alive = true;
    let url = '';
    void renderSlip(rec, labels(rec.data), action, settings.slipShow)
      .then(async (r) => ({ r, blob: await canvasBlob(r.canvas) }))
      .then(({ r, blob }) => {
        if (!alive) return;
        url = URL.createObjectURL(blob);
        setImg({ ...r, url });
      });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec, action, settings.slipShow]);
  return img;
}

/** ภาพสลิป + ชั้นข้อความโปร่งใสทับตำแหน่งเดิม (สเกลตามความกว้างที่แสดงจริง) — ลากเลือก/ไฮไลต์/คัดลอกตัวเลขได้ */
export function SlipPicture({ img, alt, className }: { img: SlipImage & { url: string }; alt: string; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const upd = () => setScale(el.clientWidth / img.width);
    upd();
    const ro = new ResizeObserver(upd);
    ro.observe(el);
    return () => ro.disconnect();
  }, [img.width]);
  return (
    <div ref={box} className={`slip-pic ${className ?? ''}`} style={{ aspectRatio: `${img.width} / ${img.height}` }}>
      <img src={img.url} alt={alt} width={img.width} height={img.height} draggable={false} />
      <div
        className="slip-text"
        style={{ width: img.width, height: img.height, transform: `scale(${scale})` }}
        aria-hidden="true"
        /* คลิกขวา (ไม่มีข้อความถูกเลือกอยู่) → ปล่อยให้เมนูของเบราว์เซอร์ตกที่รูปข้างล่าง (Copy Image / Save Image) */
        onPointerDown={(e) => {
          // ctrl+คลิก = คลิกขวาบน macOS
          if (e.button !== 2 && !(e.button === 0 && e.ctrlKey)) return;
          const sel = window.getSelection();
          if (sel && !sel.isCollapsed && e.currentTarget.contains(sel.anchorNode)) return;
          const el = e.currentTarget;
          el.style.pointerEvents = 'none';
          setTimeout(() => {
            el.style.pointerEvents = '';
          }, 600);
        }}
      >
        {img.texts.map((tx, i) => (
          <span key={i} style={{ left: tx.align === 'right' ? tx.x - tx.w : tx.align === 'center' ? tx.x - tx.w / 2 : tx.x, top: tx.y - tx.size * 0.92, fontSize: tx.size, fontWeight: tx.weight, width: tx.w, lineHeight: `${tx.size * 1.2}px` }}>
            {tx.s}
          </span>
        ))}
      </div>
    </div>
  );
}

/** lightbox: portal ไป body, z สูงกว่าแผงขวา — Esc / คลิกม่าน ปิด; ล็อกโฟกัสไว้ที่ปุ่มปิด */
export function SlipLightbox({ data, onClose }: { data: SlipData; onClose: () => void }) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  useModalLayer(box, true);
  const [rec, setRec] = useState<SlipRecord | null>(null);
  useEffect(() => {
    let alive = true;
    void slipCode(data).then((code) => {
      if (!alive) return;
      const r = { code, data };
      saveSlip(r);
      setRec(r);
    });
    return () => {
      alive = false;
    };
  }, [data]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const img = useSlipImage(rec);
  return createPortal(
    <div ref={box} className="lightbox" role="dialog" aria-modal="true" aria-label={t('slip.title')}>
      <button type="button" className="lightbox-scrim" aria-label={t('dialog.close')} onClick={onClose} />
      <button type="button" className="btn btn-icon lightbox-close" onClick={onClose} aria-label={t('dialog.close')} autoFocus>
        <Icon name="x" />
      </button>
      <div className="lightbox-body">
        {img ? <SlipPicture img={img} alt={t('slip.title')} className="lightbox-img" /> : <span className="spinner" aria-hidden="true" />}
      </div>
    </div>,
    document.body
  );
}
