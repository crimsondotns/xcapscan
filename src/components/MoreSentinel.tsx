import type { RefObject } from 'react';
import { useI18n } from '../i18n';
import { Spinner } from '@/components/ui/spinner';

/** ท้ายตารางสำหรับเลื่อนไม่รู้จบ: จุดสังเกต + "กำลังโหลดเพิ่ม…" เล็กๆ (ไม่กระโดด: ความสูงคงที่); "ครบแล้ว" เฉพาะเมื่อเคยเลื่อนโหลดเพิ่มจริง */
export function MoreSentinel({ sentinel, loading, exhausted, count, page }: { sentinel: RefObject<HTMLDivElement | null>; loading: boolean; exhausted: boolean; count: number; page: number }) {
  const { t } = useI18n();
  return (
    <div ref={sentinel} className="flex h-10 items-center justify-center gap-2 text-sm text-muted-foreground" aria-live="polite">
      {loading ? (
        <>
          <Spinner />
          {t('tx.loadingMore')}
        </>
      ) : exhausted && count > page ? (
        t('tx.end')
      ) : null}
    </div>
  );
}
