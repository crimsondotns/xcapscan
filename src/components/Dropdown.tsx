/**
 * Dropdown — ห่อ shadcn Select (Base UI) ให้ API เดิม: value/options/onChange/label
 * ห้ามใช้ <select> native; คีย์บอร์ด/โฟกัส/aria มาจาก Base UI
 */
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export interface DropdownOption<V extends string> {
  value: V;
  label: ReactNode;
  meta?: ReactNode;
}

interface Props<V extends string> {
  value: V;
  options: Array<DropdownOption<V>>;
  onChange: (v: V) => void;
  /** ชื่อของตัวควบคุมสำหรับ screen reader (มองไม่เห็น) */
  label: string;
  /** ข้อความบนปุ่มเมื่อไม่อยาก echo label ของตัวเลือก (เช่นตัวย่อภาษา) */
  display?: ReactNode;
  align?: 'left' | 'right';
  className?: string;
  size?: 'md' | 'sm';
}

export function Dropdown<V extends string>({ value, options, onChange, label, display, align = 'left', className, size = 'md' }: Props<V>) {
  const current = options.find((o) => o.value === value);
  return (
    <Select value={value} onValueChange={(v) => v != null && onChange(v as V)}>
      <SelectTrigger size={size === 'sm' ? 'sm' : 'default'} aria-label={label} className={cn('min-w-0', className)}>
        <SelectValue>{() => display ?? current?.label}</SelectValue>
      </SelectTrigger>
      {/* รายการกว้างตามชื่อที่ยาวที่สุด (ไม่ล็อกเท่าปุ่ม) แต่ไม่เกินจอ — ชื่อยาวเกินจอจึงตัด … */}
      <SelectContent align={align === 'right' ? 'end' : 'start'} alignItemWithTrigger={false} className="w-auto min-w-(--anchor-width) max-w-[min(28rem,calc(100vw-2rem))]">
        <SelectGroup>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} title={typeof o.label === 'string' ? o.label : undefined}>
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {o.meta != null && <span className="ml-auto text-muted-foreground tabular-nums">{o.meta}</span>}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
