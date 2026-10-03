/** แท็บของหน้า (ชื่อ + จำนวน) — shadcn Tabs แบบเส้นใต้ (variant line); คีย์บอร์ด/aria มาจาก Base UI */
import { useI18n } from '../i18n';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

export interface PageTab<V extends string> {
  value: V;
  label: string;
  count?: number;
  /** กดไม่ได้ชั่วคราว (เช่น รอแท็บอื่นโหลดเสร็จ) */
  disabled?: boolean;
}

export function PageTabs<V extends string>({ value, tabs, onChange, label }: { value: V; tabs: Array<PageTab<V>>; onChange: (v: V) => void; label?: string }) {
  const { t } = useI18n();
  return (
    <Tabs value={value} onValueChange={(v) => onChange(v as V)}>
      <TabsList variant="line" aria-label={label ?? t('tab.list')}>
        {tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value} disabled={tab.disabled}>
            {tab.label}
            {tab.count !== undefined && (
              <Badge variant="secondary" className="tabular-nums">
                {tab.count}
              </Badge>
            )}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
