/**
 * Dropdown panel — ตัวเดียวใช้ทุกที่ ห้ามใช้ <select> native
 * ปุ่มเปิดเป็น pill (secondary button), แผงลอยมุม 12px เส้นขอบ hairline เงาอ่อน
 * รายการสูง 40px มุม 8px; คีย์บอร์ด: ลูกศรเลื่อน, Home/End, Enter/Space เลือก, Esc ปิด
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from './Icon';

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
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const items = useRef<Array<HTMLButtonElement | null>>([]);
  const id = useId();
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    items.current[Math.max(0, options.findIndex((o) => o.value === value))]?.focus();
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, options, value]);

  function close(focusBtn = true) {
    setOpen(false);
    if (focusBtn) btn.current?.focus();
  }

  function onListKey(e: KeyboardEvent, i: number) {
    const n = options.length;
    const go = (k: number) => items.current[((k % n) + n) % n]?.focus();
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        go(i + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        go(i - 1);
        break;
      case 'Home':
        e.preventDefault();
        go(0);
        break;
      case 'End':
        e.preventDefault();
        go(n - 1);
        break;
      case 'Escape':
      case 'Tab':
        close(e.key === 'Escape');
        break;
    }
  }

  function onBtnKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
    }
  }

  return (
    <div className={`dd${className ? ` ${className}` : ''}`} ref={root}>
      <button
        ref={btn}
        type="button"
        className={`btn dd-btn${size === 'sm' ? ' btn-sm' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onBtnKey}
      >
        <span className="dd-text">{display ?? current?.label}</span>
        <Icon name="chevronDown" className="dd-chev" />
      </button>
      {open && (
        <ul id={id} className={`dd-panel${align === 'right' ? ' dd-right' : ''}`} role="listbox" aria-label={label}>
          {options.map((o, i) => (
            <li key={o.value} role="none">
              <button
                type="button"
                role="option"
                aria-selected={o.value === value}
                className="dd-item"
                ref={(el) => {
                  items.current[i] = el;
                }}
                onKeyDown={(e) => onListKey(e, i)}
                onClick={() => {
                  onChange(o.value);
                  close();
                }}
              >
                <span className="dd-item-text">{o.label}</span>
                {o.meta !== undefined && <small>{o.meta}</small>}
                <Icon name="check" className="dd-check" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
