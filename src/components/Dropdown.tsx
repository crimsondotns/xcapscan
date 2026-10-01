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
      <SelectContent align={align === 'right' ? 'end' : 'start'} alignItemWithTrigger={false}>
        <SelectGroup>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
              {o.meta != null && <span className="ml-auto text-muted-foreground tabular-nums">{o.meta}</span>}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
