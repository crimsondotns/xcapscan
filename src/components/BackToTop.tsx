/** ปุ่ม Back to top (ผู้ใช้ 2026-10-02) — ลอยมุมขวาล่าง ทั้งเดสก์ท็อปและมือถือ; ขึ้นเมื่อเลื่อนลงเกิน 1 จอ, เคารพ prefers-reduced-motion */
import { useEffect, useState } from 'react';
import { ArrowUpIcon } from 'lucide-react';
import { useI18n } from '../i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export function BackToTop() {
  const { t } = useI18n();
  const [show, setShow] = useState(false);
  useEffect(() => {
    const on = () => setShow(window.scrollY > window.innerHeight);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  const top = () => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    document.getElementById('main')?.focus({ preventScroll: true });
  };
  return (
    <Button
      type="button"
      variant="outline"
      size="icon-lg"
      aria-label={t('nav.top')}
      title={t('nav.top')}
      onClick={top}
      tabIndex={show ? 0 : -1}
      aria-hidden={!show}
      className={cn('fixed right-4 size-11 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-10 rounded-full bg-background shadow-md transition-[opacity,translate] motion-reduce:transition-none sm:right-6 sm:bottom-6', show ? 'opacity-100' : 'pointer-events-none translate-y-2 opacity-0')}
    >
      <ArrowUpIcon />
    </Button>
  );
}
