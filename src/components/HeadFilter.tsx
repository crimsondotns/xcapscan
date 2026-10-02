/**
 * ตัวกรองในหัวคอลัมน์ (จอ ≥640, ผู้ใช้ 2026-10-02) — ไอคอนกรวยข้างปุ่มเรียง เปิด Popover ของคอลัมน์นั้น
 * แก้เป็นฉบับร่างแล้วกด Show N results; Reset ล้างเฉพาะคอลัมน์นี้; ใช้อยู่ = กรวยทึบสี primary
 */
import { useState, type ReactNode } from 'react';
import { FilterIcon } from 'lucide-react';
import { useI18n } from '../i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';

export function HeadFilter<T>({ label, value, onChange, active, clear, countFor, wide, children }: { label: string; value: T; onChange: (v: T) => void; active: boolean; clear: (d: T) => T; countFor: (d: T) => number; wide?: boolean; children: (draft: T, set: (p: Partial<T>) => void, apply: () => void) => ReactNode }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const set = (p: Partial<T>) => setDraft((d) => ({ ...d, ...p }));
  const apply = () => {
    onChange(draft);
    setOpen(false);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (o) setDraft(value);
        setOpen(o);
      }}
      modal
    >
      <PopoverTrigger render={<Button type="button" variant="ghost" size="icon-xs" aria-label={`${t('af.title')}: ${label}`} className={cn('-ml-1 align-middle', active ? 'text-primary' : 'text-muted-foreground')} />}>
        <FilterIcon fill={active ? 'currentColor' : 'none'} />
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} className={cn(wide ? 'w-[400px]' : 'w-[320px]', 'max-w-[calc(100vw-2rem)] gap-4 p-4 text-left font-normal')}>
        <PopoverHeader className="flex-row items-center justify-between">
          <PopoverTitle>{label}</PopoverTitle>
          <Button variant="link" size="sm" className="px-0" onClick={() => setDraft(clear(draft))}>
            {t('af.reset')}
          </Button>
        </PopoverHeader>
        {children(draft, set, apply)}
        <Button onClick={apply}>{t('af.show', { n: countFor(draft) })}</Button>
      </PopoverContent>
    </Popover>
  );
}
