/**
 * เส้นทางแบบ path จริง (ไม่มี #): <base>/ = แดชบอร์ด, <base>/wallet/<id> = กระเป๋า, <base>/verify/<code>[.<data>] = ตรวจสลิป (รายการเต็มดู parseRoute ใน App.tsx)
 * ใช้ History API; static host ที่ไม่รู้จัก path จะเสิร์ฟ public/404.html ซึ่งเด้งกลับมาที่ <base>/?p=<path> แล้วตรงนี้คืน path ให้
 */
import { useEffect, useState } from 'react';

const BASE = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';

function current(): string {
  let p = location.pathname;
  if (p.startsWith(BASE)) p = p.slice(BASE.length);
  return p.replace(/^\/+|\/+$/g, '');
}

/** path ปัจจุบัน (ไม่มี base, ไม่มี / หัวท้าย) — อัปเดตเมื่อ navigate()/ย้อนกลับ */
export function useRoute(): string {
  const [route, setRoute] = useState(() => {
    // เด้งมาจาก 404.html → คืน path เดิมโดยไม่ทิ้งประวัติ
    const q = new URLSearchParams(location.search).get('p');
    if (q !== null) {
      history.replaceState(null, '', `${BASE}${q.replace(/^\/+/, '')}`);
    }
    return current();
  });
  useEffect(() => {
    const on = () => setRoute(current());
    window.addEventListener('popstate', on);
    window.addEventListener('xcap:navigate', on);
    return () => {
      window.removeEventListener('popstate', on);
      window.removeEventListener('xcap:navigate', on);
    };
  }, []);
  return route;
}

/** ไดอะล็อกที่เปิดอยู่ (?open=<ชื่อ>) — ไม่ใช่หน้า จึงอยู่ใน query ไม่แตะ path: หน้าข้างหลังยังเป็นหน้าเดิม */
export function useOpenParam(): string | null {
  const [v, setV] = useState(() => new URLSearchParams(location.search).get('open'));
  useEffect(() => {
    const on = () => setV(new URLSearchParams(location.search).get('open'));
    window.addEventListener('popstate', on);
    window.addEventListener('xcap:navigate', on);
    return () => {
      window.removeEventListener('popstate', on);
      window.removeEventListener('xcap:navigate', on);
    };
  }, []);
  return v;
}

export function navigate(path: string, replace = false): void {
  const url = `${BASE}${path.replace(/^\/+/, '')}`;
  if (replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
  window.dispatchEvent(new Event('xcap:navigate'));
}

export function absoluteUrl(path: string): string {
  return `${location.origin}${BASE}${path.replace(/^\/+/, '')}`;
}
