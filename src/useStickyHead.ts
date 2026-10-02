/**
 * หัวตารางติดใต้แถบบนเมื่อเลื่อนหน้า — คืน ref ของ <thead> กับสถานะ "ติดอยู่ไหม"
 * ใส่เงาเฉพาะตอนติดจริง (ตารางยังอยู่ในจอ) ไม่งั้นจะมีเงาลอยค้างตอนเลื่อนผ่านตารางไปแล้ว
 */
import { useEffect, useRef, useState } from 'react';

/** ขอบล่างจริงของแถบบน (มือถือมีแถวค้นหาเพิ่ม) — เขียนลง --sticky-top ให้ CSS ของ thead ใช้ */
function topEdge(): number {
  const h = Math.round(document.querySelector('.top')?.getBoundingClientRect().height ?? 64);
  document.documentElement.style.setProperty('--sticky-top', `${h}px`);
  return h;
}

export function useStickyHead() {
  const ref = useRef<HTMLTableSectionElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const on = () => {
      const el = ref.current;
      if (!el) return;
      const TOP = topEdge() + 1; // +1px กันปัดเศษ
      const top = el.getBoundingClientRect().top;
      const table = el.parentElement?.getBoundingClientRect();
      setStuck(top <= TOP && !!table && table.bottom > top + el.offsetHeight);
    };
    on();
    window.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on);
    return () => {
      window.removeEventListener('scroll', on);
      window.removeEventListener('resize', on);
    };
  }, []);
  return { ref, stuck };
}
