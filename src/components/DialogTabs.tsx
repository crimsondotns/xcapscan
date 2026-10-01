/** แท็บในไดอะล็อก — shadcn Tabs (Base UI): แนวนอนบนมือถือ แนวตั้งด้านซ้ายบนจอกว้าง; คีย์บอร์ด/aria มาจาก Base UI
 *  ส่วนเนื้อหาสูงคงที่ (เลื่อนในตัว) — สลับแท็บแล้วไดอะล็อกไม่ยืด/หด */
import type { ReactNode } from 'react';
import { useIsMobile } from '@/hooks/useIsMobile';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Icon, type IconName } from './Icon';

export interface TabDef<T extends string> {
  id: T;
  label: string;
  icon: IconName;
}

export function DialogTabs<T extends string>({ tabs, active, onChange, label, children }: { tabs: Array<TabDef<T>>; active: T; onChange: (id: T) => void; label: string; children: ReactNode }) {
  const mobile = useIsMobile();
  return (
    <Tabs value={active} onValueChange={(v) => onChange(v as T)} orientation={mobile ? 'horizontal' : 'vertical'} className="gap-6 max-sm:min-h-0 max-sm:flex-1">
      <TabsList aria-label={label} className={mobile ? 'w-full' : 'w-44 shrink-0 self-start'}>
        {tabs.map((tb) => (
          <TabsTrigger key={tb.id} value={tb.id}>
            <Icon name={tb.icon} data-icon="inline-start" />
            {tb.label}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value={active} className="flex h-[min(560px,60dvh)] max-sm:h-auto max-sm:min-h-0 max-sm:flex-1 min-w-0 flex-col gap-6 overflow-y-auto overscroll-contain">
        {children}
      </TabsContent>
    </Tabs>
  );
}
