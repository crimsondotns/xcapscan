import { useSyncExternalStore } from 'react';

/** < 640px = มือถือ (เบรกพอยต์ของแอป) */
const QUERY = '(max-width: 639px)';
export function useIsMobile(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(QUERY);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => window.matchMedia(QUERY).matches
  );
}
