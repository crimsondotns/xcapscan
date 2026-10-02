/** ปุ่ม Filters ของตาราง Balance (ผู้ใช้ 2026-10-02) — เชน + ช่วงมูลค่า USD; แก้เป็นฉบับร่างแล้วกด Show N results; ตัวที่ใช้อยู่เป็นชิปลบได้ */
import { useState, type ReactNode } from 'react';
import { FilterIcon, PlusIcon, Trash2Icon, XIcon } from 'lucide-react';
import { useI18n } from '../i18n';
import { useIsMobile } from '@/hooks/useIsMobile';
import { matchBalance, type BalanceRow } from '../balances';
import { cn } from '@/lib/utils';
import { Dropdown, type DropdownOption } from './Dropdown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@/components/ui/input-group';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';

/** เงื่อนไขโทเคน: q จับ symbol/name (มีคำนี้) หรือ address (ขึ้นต้นด้วย) — include = ต้องตรงอย่างน้อยหนึ่ง, exclude = ห้ามตรง */
export interface TokenCond {
  q: string;
  mode: 'include' | 'exclude';
}
export interface BalFilter {
  chain: string;
  usdMin: string;
  usdMax: string;
  tokens: TokenCond[];
}
export const BAL_EMPTY: BalFilter = { chain: '', usdMin: '', usdMax: '', tokens: [] };
const BLANK: TokenCond = { q: '', mode: 'include' };
const live = (l: TokenCond[]) => l.filter((c) => c.q.trim());

/** แถวผ่านเงื่อนไขโทเคนไหม (แถวว่างไม่นับ) */
export function inTokens(r: BalanceRow, list: TokenCond[]): boolean {
  const l = live(list);
  const inc = l.filter((c) => c.mode === 'include');
  if (inc.length && !inc.some((c) => matchBalance(r, c.q))) return false;
  return !l.some((c) => c.mode === 'exclude' && matchBalance(r, c.q));
}
/** ทุกตัวกรองของตาราง Balance ยกเว้น Hide suspicious */
export function passBal(r: BalanceRow, f: BalFilter): boolean {
  return matchBalance(r, '', f.chain) && inUsdRange(r.usd, f) && inTokens(r, f.tokens);
}
const activeCount = (f: BalFilter) => (f.chain ? 1 : 0) + (f.usdMin || f.usdMax ? 1 : 0) + live(f.tokens).length;

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

/** รายการเงื่อนไขโทเคน (ภาพอ้างอิงผู้ใช้ 2026-10-02): ช่องพิมพ์ · Include/Exclude · ถังขยะ, + Add token — ไม่มี placeholder (Zero hints) */
function TokenConds({ list, onChange, idp }: { list: TokenCond[]; onChange: (l: TokenCond[]) => void; idp: string }) {
  const { t } = useI18n();
  const rows = list.length ? list : [BLANK];
  const put = (i: number, p: Partial<TokenCond>) => onChange(rows.map((c, j) => (j === i ? { ...c, ...p } : c)));
  const modes: Array<DropdownOption<TokenCond['mode']>> = [
    { value: 'include', label: t('af.include') },
    { value: 'exclude', label: t('af.exclude') },
  ];
  return (
    <FieldSet className="gap-2">
      <FieldLegend variant="label">{t('af.token')}</FieldLegend>
      {rows.map((c, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input id={`${idp}-tq-${i}`} aria-label={`${t('af.token')} ${i + 1}`} type="text" autoComplete="off" spellCheck={false} className="min-w-0 flex-1" value={c.q} onChange={(e) => put(i, { q: e.target.value })} />
          <Dropdown value={c.mode} options={modes} onChange={(mode) => put(i, { mode })} label={t('af.include')} className="w-28 shrink-0" />
          <Button type="button" variant="ghost" size="icon" aria-label={t('af.remove', { what: `${t('af.token')} ${i + 1}` })} disabled={rows.length === 1 && !c.q} onClick={() => onChange(rows.length === 1 ? [] : rows.filter((_, j) => j !== i))}>
            <Trash2Icon />
          </Button>
        </div>
      ))}
      <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => onChange([...rows, BLANK])}>
        <PlusIcon data-icon="inline-start" />
        {t('af.addToken')}
      </Button>
    </FieldSet>
  );
}

function Form({ f, set, chains, idp }: { f: BalFilter; set: (p: Partial<BalFilter>) => void; chains: Array<DropdownOption<string>>; idp: string }) {
  const { t } = useI18n();
  return (
    <FieldGroup className="gap-5">
      <TokenConds list={f.tokens} onChange={(tokens) => set({ tokens })} idp={idp} />
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

/**
 * ตัวกรองในหัวคอลัมน์ (จอ ≥640, ผู้ใช้ 2026-10-02) — ไอคอนกรวยข้างปุ่มเรียง เปิด Popover ของคอลัมน์นั้น
 * ฉบับร่างเหมือนปุ่ม Filters: แก้แล้วกด Show N results; Reset ล้างเฉพาะคอลัมน์นี้
 */
export function ColumnFilter({ field, value, onChange, chains, countFor, label }: { field: 'chain' | 'usd'; value: BalFilter; onChange: (f: BalFilter) => void; chains: Array<DropdownOption<string>>; countFor: (f: BalFilter) => number; label: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const set = (p: Partial<BalFilter>) => setDraft((d) => ({ ...d, ...p }));
  const active = field === 'chain' ? !!value.chain || live(value.tokens).length > 0 : !!(value.usdMin || value.usdMax);
  const clear: Partial<BalFilter> = field === 'chain' ? { chain: '', tokens: [] } : { usdMin: '', usdMax: '' };
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
        {/* ใช้อยู่ = กรวยทึบสี primary (แบบภาพอ้างอิง) */}
        <FilterIcon fill={active ? 'currentColor' : 'none'} />
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} className={cn(field === 'chain' ? 'w-[400px]' : 'w-[320px]', 'max-w-[calc(100vw-2rem)] gap-4 p-4 text-left')}>
        <PopoverHeader className="flex-row items-center justify-between">
          <PopoverTitle>{label}</PopoverTitle>
          <Button variant="link" size="sm" className="px-0" onClick={() => set(clear)}>
            {t('af.reset')}
          </Button>
        </PopoverHeader>
        {field === 'chain' ? (
          <FieldGroup className="gap-4">
            <TokenConds list={draft.tokens} onChange={(tokens) => set({ tokens })} idp="cf" />
            {chains.length > 2 && (
              <Field>
                <FieldLabel>{t('tx.col.chain')}</FieldLabel>
                <Dropdown value={draft.chain} options={chains} onChange={(chain) => set({ chain })} label={t('bal.allChains')} className="w-full" />
              </Field>
            )}
          </FieldGroup>
        ) : (
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            {(['usdMin', 'usdMax'] as const).map((k, i) => (
              <InputGroup key={k} className={i ? 'col-start-3' : undefined}>
                <InputGroupAddon>
                  <InputGroupText>$</InputGroupText>
                </InputGroupAddon>
                {/* placeholder Min/Max = ข้อยกเว้น Zero hints ที่ผู้ใช้สั่ง */}
                <InputGroupInput aria-label={`${label} ${t(i ? 'af.max' : 'af.min')}`} placeholder={t(i ? 'af.max' : 'af.min')} type="text" inputMode="decimal" autoComplete="off" value={draft[k]} onChange={(e) => set({ [k]: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && apply()} />
              </InputGroup>
            ))}
            <span className="col-start-2 row-start-1 text-muted-foreground">–</span>
          </div>
        )}
        <Button onClick={apply}>{t('af.show', { n: countFor(draft) })}</Button>
      </PopoverContent>
    </Popover>
  );
}

function useChips(f: BalFilter, chainLabel: (id: string) => ReactNode): Array<[string, ReactNode]> {
  const { t } = useI18n();
  const out: Array<[string, ReactNode]> = [];
  f.tokens.forEach((c, i) => c.q.trim() && out.push([`tok-${i}`, `${t('af.token')}: ${c.mode === 'exclude' ? `${t('af.exclude')} ` : ''}${c.q.trim()}`]));
  if (f.chain) out.push(['chain', chainLabel(f.chain)]);
  /* แบบภาพอ้างอิง: Value: Min $1 · Value: Max $5 · Value: $1 – $5 */
  if (f.usdMin || f.usdMax) out.push(['usd', `${t('bal.col.value')}: ${f.usdMin && f.usdMax ? `$${f.usdMin} – $${f.usdMax}` : f.usdMin ? `${t('af.min')} $${f.usdMin}` : `${t('af.max')} $${f.usdMax}`}`]);
  return out;
}

export function BalanceFilterButton({ value, onChange, chains, countFor }: { value: BalFilter; onChange: (f: BalFilter) => void; chains: Array<DropdownOption<string>>; countFor: (f: BalFilter) => number }) {
  const { t } = useI18n();
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const set = (p: Partial<BalFilter>) => setDraft((d) => ({ ...d, ...p }));
  const n = activeCount(value);
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

/** ชิปตัวกรองที่ใช้อยู่ (ผู้ใช้ 2026-10-02 ตามภาพอ้างอิง): "Clear filters ×" นำหน้า แล้วชิปละตัวกรองพร้อม × */
export function BalanceFilterChips({ value, onChange, chainLabel }: { value: BalFilter; onChange: (f: BalFilter) => void; chainLabel: (id: string) => ReactNode }) {
  const { t } = useI18n();
  const list = useChips(value, chainLabel);
  if (!list.length) return null;
  const chip = (key: string, label: ReactNode, onClick: () => void, aria: string) => (
    <Badge key={key} variant="secondary" className="h-7 gap-1 pr-1 pl-2.5">
      {label}
      <Button variant="ghost" size="icon-xs" aria-label={aria} onClick={onClick}>
        <XIcon />
      </Button>
    </Badge>
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      {chip('clear', t('af.clearFilters'), () => onChange(BAL_EMPTY), t('af.clearFilters'))}
      {list.map(([k, l]) => chip(k, l, () => onChange(k === 'usd' ? { ...value, usdMin: '', usdMax: '' } : k === 'chain' ? { ...value, chain: '' } : { ...value, tokens: value.tokens.filter((_, j) => `tok-${j}` !== k) }), t('af.remove', { what: typeof l === 'string' ? l : k })))}
    </div>
  );
}
