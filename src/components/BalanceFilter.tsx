/** ปุ่ม Filters ของตาราง Balance (ผู้ใช้ 2026-10-02) — เชน + ช่วงมูลค่า USD; แก้เป็นฉบับร่างแล้วกด Show N results; ตัวที่ใช้อยู่เป็นชิปลบได้ */
import { useState, type ReactNode } from 'react';
import { FilterIcon, XIcon } from 'lucide-react';
import { useI18n } from '../i18n';
import { useIsMobile } from '@/hooks/useIsMobile';
import { Dropdown, type DropdownOption } from './Dropdown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@/components/ui/input-group';
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';

export interface BalFilter {
  chain: string;
  usdMin: string;
  usdMax: string;
}
export const BAL_EMPTY: BalFilter = { chain: '', usdMin: '', usdMax: '' };

const num = (v: string) => {
  const n = parseFloat(v.replace(/[,$\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};
/** แถวผ่านช่วงมูลค่าไหม — ไม่มีราคานับเป็น 0 */
export function inUsdRange(usd: number | null, f: BalFilter): boolean {
  const lo = num(f.usdMin);
  const hi = num(f.usdMax);
  const v = usd ?? 0;
  return (lo === null || v >= lo) && (hi === null || v <= hi);
}

function Form({ f, set, chains, idp }: { f: BalFilter; set: (p: Partial<BalFilter>) => void; chains: Array<DropdownOption<string>>; idp: string }) {
  const { t } = useI18n();
  return (
    <FieldGroup className="gap-5">
      {chains.length > 2 && (
        <Field>
          <FieldLabel>{t('tx.col.chain')}</FieldLabel>
          <Dropdown value={f.chain} options={chains} onChange={(chain) => set({ chain })} label={t('bal.allChains')} className="w-full" />
        </Field>
      )}
      <FieldSet className="gap-2">
        <FieldLegend variant="label">{t('bal.col.value')} (USD)</FieldLegend>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          {(['usdMin', 'usdMax'] as const).map((k, i) => (
            <InputGroup key={k} className={i ? 'col-start-3' : undefined}>
              <InputGroupAddon>
                <InputGroupText>$</InputGroupText>
              </InputGroupAddon>
              {/* placeholder Min/Max = ข้อยกเว้น Zero hints ที่ผู้ใช้สั่ง */}
              <InputGroupInput id={`${idp}-${k}`} aria-label={`${t('bal.col.value')} ${t(i ? 'af.max' : 'af.min')}`} placeholder={t(i ? 'af.max' : 'af.min')} type="text" inputMode="decimal" autoComplete="off" value={f[k]} onChange={(e) => set({ [k]: e.target.value })} />
            </InputGroup>
          ))}
          <span className="col-start-2 row-start-1 text-muted-foreground">–</span>
        </div>
      </FieldSet>
    </FieldGroup>
  );
}

function useChips(f: BalFilter, chainLabel: (id: string) => ReactNode): Array<[keyof BalFilter | 'usd', ReactNode]> {
  const { t } = useI18n();
  const out: Array<[keyof BalFilter | 'usd', ReactNode]> = [];
  if (f.chain) out.push(['chain', chainLabel(f.chain)]);
  if (f.usdMin || f.usdMax) out.push(['usd', `${t('bal.col.value')}: ${f.usdMin ? `$${f.usdMin}` : '…'} – ${f.usdMax ? `$${f.usdMax}` : '…'}`]);
  return out;
}

export function BalanceFilterButton({ value, onChange, chains, countFor }: { value: BalFilter; onChange: (f: BalFilter) => void; chains: Array<DropdownOption<string>>; countFor: (f: BalFilter) => number }) {
  const { t } = useI18n();
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const set = (p: Partial<BalFilter>) => setDraft((d) => ({ ...d, ...p }));
  const n = (value.chain ? 1 : 0) + (value.usdMin || value.usdMax ? 1 : 0);
  const openWith = (o: boolean) => {
    if (o) setDraft(value);
    setOpen(o);
  };
  const apply = () => {
    onChange(draft);
    setOpen(false);
  };
  const trigger = (
    <Button variant={n ? 'secondary' : 'outline'} aria-label={t('af.title')} onClick={mobile ? () => openWith(true) : undefined}>
      <FilterIcon data-icon="inline-start" />
      {t('af.title')}
      {n > 0 && <Badge className="tabular-nums">{n}</Badge>}
    </Button>
  );
  const head = (Title: typeof PopoverTitle | typeof DrawerTitle) => (
    <>
      <Title className="text-base">{t('af.title')}</Title>
      <Button variant="link" size="sm" className="px-0" onClick={() => setDraft(BAL_EMPTY)}>
        {t('af.reset')}
      </Button>
    </>
  );
  const show = t('af.show', { n: countFor(draft) });

  if (mobile)
    return (
      <>
        {trigger}
        <Drawer open={open} onOpenChange={openWith}>
          <DrawerContent className="max-h-[92dvh]">
            <DrawerHeader className="flex-row items-center justify-between">{head(DrawerTitle)}</DrawerHeader>
            <div className="overflow-y-auto overscroll-contain px-4 pb-2">
              <Form f={draft} set={set} chains={chains} idp="bfm" />
            </div>
            <DrawerFooter className="flex-row border-t pt-4">
              <Button variant="outline" onClick={() => setOpen(false)}>
                {t('dialog.cancel')}
              </Button>
              <Button className="flex-1" onClick={apply}>
                {show}
              </Button>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      </>
    );

  return (
    <Popover open={open} onOpenChange={openWith} modal>
      <PopoverTrigger render={trigger} />
      <PopoverContent align="start" sideOffset={8} className="w-[380px] max-w-[calc(100vw-2rem)] gap-4 p-5">
        <PopoverHeader className="flex-row items-center justify-between">{head(PopoverTitle)}</PopoverHeader>
        <Form f={draft} set={set} chains={chains} idp="bfd" />
        <Separator />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t('dialog.cancel')}
          </Button>
          <Button onClick={apply}>{show}</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function BalanceFilterChips({ value, onChange, chainLabel }: { value: BalFilter; onChange: (f: BalFilter) => void; chainLabel: (id: string) => ReactNode }) {
  const { t } = useI18n();
  const list = useChips(value, chainLabel);
  if (!list.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {list.map(([k, l]) => (
        <Badge key={k} variant="secondary" className="h-7 gap-1 pr-1 pl-2.5">
          {l}
          <Button variant="ghost" size="icon-xs" aria-label={t('af.remove', { what: typeof l === 'string' ? l : k })} onClick={() => onChange(k === 'usd' ? { ...value, usdMin: '', usdMax: '' } : { ...value, chain: '' })}>
            <XIcon />
          </Button>
        </Badge>
      ))}
      <Button variant="link" size="sm" className="text-muted-foreground" onClick={() => onChange(BAL_EMPTY)}>
        {t('af.clear')}
      </Button>
    </div>
  );
}
