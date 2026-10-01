/** สลิปธุรกรรม — เปิดภาพแบบ lightbox (ม่านมืด + ภาพกลาง + ปิดมุมขวาบน) ไม่ใช่ไดอะล็อก ไม่มีแถบปุ่ม — ผู้ใช้คลิกขวา/ลากภาพเซฟเองแบบรูปทั่วไป */
import { useEffect, useMemo, useRef, useState } from 'react';
import { CopyIcon, DownloadIcon, ImageDownIcon, TypeIcon } from 'lucide-react';
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { useToast } from './Toast';
import { useI18n } from '../i18n';
import { useStore } from '../store';
import { canvasBlob, renderSlip, saveSlip, slipCode, type SlipAction, type SlipData, type SlipImage, type SlipRecord } from '../slip';
import { Icon } from './Icon';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { useIsMobile } from '@/hooks/useIsMobile';

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
/** บันทึก/คัดลอกภาพสลิป — เรียกจากคลิกของผู้ใช้เท่านั้น (เบราว์เซอร์ขอ user gesture) */
async function copyImage(url: string): Promise<void> {
  // Chrome: ถามสิทธิ์ก่อน (Safari ไม่มี permission นี้ แต่ยอมเมื่อมาจากคลิก)
  try {
    const st = await navigator.permissions?.query({ name: 'clipboard-write' as PermissionName });
    if (st?.state === 'denied') throw new Error('denied');
  } catch (e) {
    if (e instanceof Error && e.message === 'denied') throw e;
  }
  // ส่ง Promise<Blob> เข้า ClipboardItem ทันที — Safari ต้องให้สร้าง item ภายในจังหวะคลิก
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': fetch(url).then((r) => r.blob()) })]);
}
function downloadImage(url: string, name: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
}
/** มือถือ: แผ่นแชร์ของระบบมี "บันทึกรูปภาพ" — ระบบขอสิทธิ์เข้าคลังรูปภาพเองตอนกดครั้งแรก (เว็บเขียนลง Gallery ตรงไม่ได้) */
async function imageFile(url: string, name: string): Promise<File> {
  return new File([await (await fetch(url)).blob()], name, { type: 'image/png' });
}
function canShareImage(): boolean {
  try {
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File([new Blob()], 'x.png', { type: 'image/png' })] });
  } catch {
    return false;
  }
}

export function SlipPicture({ img, alt, className, name = 'xcapscan-slip.png' }: { img: SlipImage & { url: string }; alt: string; className?: string; name?: string }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [selected, setSelected] = useState('');
  const shareable = useMemo(canShareImage, []);
  const mobile = useIsMobile();
  const [sheet, setSheet] = useState(false);
  const press = useRef<number | undefined>(undefined);
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
  const run = (fn: () => Promise<void> | void, ok: string, fail: string) =>
    void Promise.resolve()
      .then(fn)
      .then(
        () => toast(ok),
        (e: unknown) => {
          if (e instanceof DOMException && e.name === 'AbortError') return; // ผู้ใช้ปิดแผ่นแชร์เอง
          toast(fail);
        },
      );
  const grab = () => {
    const sel = window.getSelection();
    setSelected(sel && !sel.isCollapsed && box.current?.contains(sel.anchorNode) ? sel.toString() : '');
  };
  type Action = { key: string; icon: typeof CopyIcon; label: string; go: () => void };
  const actions = ([
    selected && { key: 'text', icon: TypeIcon, label: t('slip.menu.copyText'), go: () => run(() => navigator.clipboard.writeText(selected), t('slip.did.copy'), t('slip.copyFailed')) },
    { key: 'copy', icon: CopyIcon, label: t('slip.menu.copy'), go: () => run(() => copyImage(img.url), t('slip.did.copy'), t('slip.copyFailed')) },
    { key: 'dl', icon: DownloadIcon, label: t('slip.menu.download'), go: () => run(() => downloadImage(img.url, name), t('slip.did.download'), t('slip.saveFailed')) },
    shareable && { key: 'save', icon: ImageDownIcon, label: t('slip.menu.save'), go: () => run(async () => navigator.share({ files: [await imageFile(img.url, name)] }), t('slip.did.save'), t('slip.saveFailed')) },
  ] as Array<Action | false | ''>).filter((a): a is Action => !!a);
  const picture = (
    <>
      <img src={img.url} alt={alt} width={img.width} height={img.height} draggable={false} />
      <div className="slip-text" style={{ width: img.width, height: img.height, transform: `scale(${scale})` }} aria-hidden="true">
        {img.texts.map((tx, i) => (
          <span key={i} style={{ left: tx.align === 'right' ? tx.x - tx.w : tx.align === 'center' ? tx.x - tx.w / 2 : tx.x, top: tx.y - tx.size * 0.92, fontSize: tx.size, fontWeight: tx.weight, width: tx.w, lineHeight: `${tx.size * 1.2}px` }}>
            {tx.s}
          </span>
        ))}
      </div>
    </>
  );
  const boxProps = { ref: box, className: `slip-pic ${className ?? ''}`, style: { aspectRatio: `${img.width} / ${img.height}` } };

  /* มือถือ (ผู้ใช้ 2026-10-01): กดค้าง → Drawer ล่างจอ แทนเมนูลอย */
  if (mobile) {
    const startPress = () => {
      clearTimeout(press.current);
      press.current = window.setTimeout(() => {
        grab();
        setSheet(true);
      }, 500);
    };
    const cancelPress = () => clearTimeout(press.current);
    return (
      <>
        <div
          {...boxProps}
          onContextMenu={(e) => {
            e.preventDefault();
            cancelPress();
            grab();
            setSheet(true);
          }}
          onPointerDown={(e) => e.pointerType !== 'mouse' && startPress()}
          onPointerUp={cancelPress}
          onPointerMove={cancelPress}
          onPointerCancel={cancelPress}
        >
          {picture}
        </div>
        <Drawer open={sheet} onOpenChange={setSheet}>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>{t('slip.title')}</DrawerTitle>
            </DrawerHeader>
            <div className="flex flex-col gap-1 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              {actions.map(({ key, icon: I, label, go }) => (
                <Button
                  key={key}
                  type="button"
                  variant="ghost"
                  size="lg"
                  className="justify-start"
                  onClick={() => {
                    setSheet(false);
                    go();
                  }}
                >
                  <I data-icon="inline-start" />
                  {label}
                </Button>
              ))}
            </div>
          </DrawerContent>
        </Drawer>
      </>
    );
  }

  return (
    <ContextMenu onOpenChange={(open) => open && grab()}>
      <ContextMenuTrigger render={<div {...boxProps} />}>{picture}</ContextMenuTrigger>
      {/* คลิกขวา (เดสก์ท็อป) */}
      <ContextMenuContent className="min-w-52">
        <ContextMenuGroup>
          {actions.map(({ key, icon: I, label, go }) => (
            <ContextMenuItem key={key} onClick={go}>
              <I />
              {label}
            </ContextMenuItem>
          ))}
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** lightbox สลิป — shadcn Dialog โปร่ง ภาพ 360px กลางจอ; ซ้อนบนแผงขวาได้ (Base UI จัดชั้น/โฟกัส/Esc ให้) */
export function SlipLightbox({ data, onClose }: { data: SlipData | null; onClose: () => void }) {
  const { t } = useI18n();
  const [rec, setRec] = useState<SlipRecord | null>(null);
  useEffect(() => {
    setRec(null);
    if (!data) return;
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
  const img = useSlipImage(rec);
  return (
    <Dialog open={data !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent showCloseButton={false} overlayClassName="bg-lightbox supports-backdrop-filter:backdrop-blur-none" className="w-auto max-w-[min(360px,calc(100vw-2rem))] bg-transparent p-0 shadow-none ring-0 sm:max-w-[360px]">
        <DialogTitle className="sr-only">{t('slip.title')}</DialogTitle>
        {/* คลิกพื้นที่โปร่งรอบภาพ (ไม่ใช่ตัวสลิป) = ปิด เหมือนคลิกม่าน */}
        <div className="grid min-h-60 place-items-center" onClick={(e) => e.target === e.currentTarget && onClose()}>
          {img ? <SlipPicture img={img} alt={t('slip.title')} className="lightbox-img" name={rec ? `xcapscan-slip-${rec.code}.png` : undefined} /> : <Spinner className="size-6 text-primary-foreground" />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
