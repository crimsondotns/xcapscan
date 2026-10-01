/**
 * โครงร่างระหว่างโหลด — shadcn Skeleton; แถวสูงเท่าแถวจริง แทนที่ด้วยข้อมูลเมื่อโหลดเสร็จ
 * cols = ความกว้างของแท่งในแต่ละคอลัมน์ (px หรือ %) ; ตัวแรกมีวงกลมไอคอนนำหน้า
 */
import { Skeleton } from '@/components/ui/skeleton';
import { TableCell, TableRow } from '@/components/ui/table';

const w = (v: string | number) => (typeof v === 'number' ? `${v}px` : v);

export function SkeletonRows({ rows = 5, cols, icon = true }: { rows?: number; cols: Array<string | number>; icon?: boolean }) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <TableRow key={i} className="h-16 hover:bg-transparent" aria-hidden="true">
          {cols.map((c, j) => (
            <TableCell key={j}>
              <span className={j > 0 ? 'flex items-center justify-end gap-3' : 'flex items-center gap-3'}>
                {j === 0 && icon && <Skeleton className="size-9 rounded-full" />}
                <Skeleton className="h-4" style={{ width: w(c) }} />
              </span>
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

export function SkeletonBar({ width = 60, height }: { width?: number | string; height?: number }) {
  return <Skeleton className="inline-block h-3.5 align-middle" style={{ width: w(width), ...(height === undefined ? {} : { height }) }} aria-hidden="true" />;
}

/** พื้นที่ใหญ่ที่ยังไม่มีข้อมูล (กราฟ) — สูงเท่าของจริงเพื่อไม่ให้หน้ากระตุกตอนข้อมูลมา */
export function SkeletonBlock({ height }: { height: number }) {
  return <Skeleton className="block w-full rounded-xl" style={{ height }} aria-hidden="true" />;
}
