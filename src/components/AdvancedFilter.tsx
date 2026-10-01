/**
 * ตัวกรองขั้นสูงของ TxTable — ปุ่ม Filters ข้างกลุ่ม dropdown → Popover (มือถือ: Drawer)
 * แก้ใน draft ก่อน กด "Show N results" ถึงกรองจริง; Cancel / Esc / คลิกนอก = ทิ้ง draft
 * ตัวที่กรองแล้วโชว์เป็นชิปใต้แถบเครื่องมือ กดกากบาทเพื่อเอาออกทีละตัว
 */
import { useMemo, useState } from 'react';
import { CalendarIcon, ChevronDownIcon, FilterIcon, XIcon } from 'lucide-react';
import { useI18n } from '../i18n';
import type { TxRow } from '../feed';
import { rowValue } from './TxTable';
import { useIsMobile } from '@/hooks/useIsMobile';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Drawer, DrawerContent, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupText } from '@/components/ui/input-group';
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

export type DatePreset = 'all' | '24h' | '7d' | '30d' | 'custom';
export interface AdvFilter {
  dir: 'all' | 'in' | 'out';
  status: 'all' | 'ok' | 'failed';
  date: DatePreset;
  from?: Date;
  to?: Date;
  amtMin: string;
  amtMax: string;
  feeMin: string;
  feeMax: string;
  tokens: string[];
  counterparty: string;
  priced: boolean;
}
export const ADV_EMPTY: AdvFilter = { dir: 'all', status: 'all', date: 'all', amtMin: '', amtMax: '', feeMin: '', feeMax: '', tokens: [], counterparty: '', priced: false };

const PRESET_SEC: Record<Exclude<DatePreset, 'all' | 'custom'>, number> = { '24h': 86400, '7d': 7 * 86400, '30d': 30 * 86400 };
const num = (s: string) => {
  const v = parseFloat(s.replace(/[,$\s]/g, ''));
  return Number.isFinite(v) ? v : null;
};
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 1000;

/** วันเริ่มของช่วงที่กรอง (วินาที) — ใช้บอกว่าต้องดึงประวัติย้อนหลังถึงไหน; null = ไม่ได้กรองวันที่ */
export function advFromTs(f: AdvFilter, now = Date.now() / 1000): number | null {
  if (f.date === 'custom') return f.from ? startOfDay(f.from) : null;
  if (f.date === 'all') return null;
  return now - PRESET_SEC[f.date];
}

/** แถวผ่านตัวกรองขั้นสูงไหม — time ของแถวเป็นวินาที */
export function advMatches(r: TxRow, f: AdvFilter, now = Date.now() / 1000): boolean {
  const real = r.moves.filter((m) => m.amount !== 0 && !m.approve);
  if (f.dir === 'in' && !real.some((m) => m.dir === 'in')) return false;
  if (f.dir === 'out' && !real.some((m) => m.dir === 'out')) return false;
  if (f.status === 'ok' && r.failed) return false;
  if (f.status === 'failed' && !r.failed) return false;
  if (f.date === 'custom') {
    if (f.from && r.time < startOfDay(f.from)) return false;
    if (f.to && r.time >= startOfDay(f.to) + 86400) return false;
  } else if (f.date !== 'all' && now - r.time > PRESET_SEC[f.date]) return false;
  const v = rowValue(r)?.value ?? null;
  const mn = num(f.amtMin);
  const mx = num(f.amtMax);
  if ((mn !== null || mx !== null) && v === null) return false;
  if (mn !== null && v! < mn) return false;
  if (mx !== null && v! > mx) return false;
  const fmn = num(f.feeMin);
  const fmx = num(f.feeMax);
  if ((fmn !== null || fmx !== null) && r.gasUsd === null) return false;
  if (fmn !== null && r.gasUsd! < fmn) return false;
  if (fmx !== null && r.gasUsd! > fmx) return false;
  if (f.tokens.length && !r.moves.some((m) => f.tokens.includes(m.symbol))) return false;
  if (f.counterparty) {
    const n = f.counterparty.toLowerCase();
    if (![r.counterparty, r.counterpartyName, r.from, r.to].some((x) => x?.toLowerCase().includes(n))) return false;
  }
  if (f.priced && rowValue(r) === null) return false;
  return true;
}

type ChipKey = 'dir' | 'status' | 'date' | 'amt' | 'fee' | 'tokens' | 'counterparty' | 'priced';
const fmtDay = (d: Date) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: '2-digit' });
const usd = (v: number) => `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
function rangeText(a: string, b: string): string | null {
  const mn = num(a);
  const mx = num(b);
  if (mn === null && mx === null) return null;
  return mn !== null && mx !== null ? `${usd(mn)}–${usd(mx)}` : mn !== null ? `≥ ${usd(mn)}` : `≤ ${usd(mx!)}`;
}
function clearKey(f: AdvFilter, k: ChipKey): AdvFilter {
  switch (k) {
    case 'date':
      return { ...f, date: 'all', from: undefined, to: undefined };
    case 'amt':
      return { ...f, amtMin: '', amtMax: '' };
    case 'fee':
      return { ...f, feeMin: '', feeMax: '' };
    default:
      return { ...f, [k]: ADV_EMPTY[k] };
  }
}

function useChips(f: AdvFilter): Array<[ChipKey, string]> {
  const { t } = useI18n();
  const out: Array<[ChipKey, string]> = [];
  if (f.dir !== 'all') out.push(['dir', `${t('af.dir')}: ${t(f.dir === 'in' ? 'af.in' : 'af.out')}`]);
  if (f.status !== 'all') out.push(['status', `${t('af.status')}: ${t(f.status === 'ok' ? 'af.ok' : 'af.failed')}`]);
  if (f.date === 'custom' && (f.from || f.to)) out.push(['date', `${t('af.date')}: ${f.from ? fmtDay(f.from) : '…'} – ${f.to ? fmtDay(f.to) : '…'}`]);
  else if (f.date !== 'all' && f.date !== 'custom') out.push(['date', t(`af.preset.${f.date}`)]);
  const a = rangeText(f.amtMin, f.amtMax);
  if (a) out.push(['amt', `${t('af.amount')}: ${a}`]);
  const fe = rangeText(f.feeMin, f.feeMax);
  if (fe) out.push(['fee', `${t('af.fee')}: ${fe}`]);
  if (f.tokens.length) out.push(['tokens', `${t('af.token')}: ${f.tokens.join(', ')}`]);
  if (f.counterparty) out.push(['counterparty', `${t('af.counterparty')}: ${f.counterparty}`]);
  if (f.priced) out.push(['priced', t('af.priced')]);
  return out;
}

/* ---------- ชิ้นส่วนฟอร์ม ---------- */

function formatDate(date: Date | undefined) {
  if (!date) return '';
  return date.toLocaleDateString('en-US', { day: '2-digit', month: 'long', year: 'numeric' });
}
function isValidDate(date: Date | undefined): date is Date {
  return !!date && !Number.isNaN(date.getTime());
}

/** ช่องวันที่ตามแบบ shadcn Date Picker Input — พิมพ์เองได้, ↓ เปิดปฏิทิน, เลือกวันแล้วปิดเอง (ไม่มี placeholder ตามกฎ Zero hints) */
function DateInput({ id, label, date, onChange }: { id: string; label: string; date?: Date; onChange: (d?: Date) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState<Date | undefined>(date);
  const [value, setValue] = useState(formatDate(date));
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <InputGroup>
        <InputGroupInput
          id={id}
          value={value}
          autoComplete="off"
          onChange={(e) => {
            const d = new Date(e.target.value);
            setValue(e.target.value);
            if (isValidDate(d)) {
              onChange(d);
              setMonth(d);
            } else if (!e.target.value.trim()) onChange(undefined);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
            }
          }}
        />
        <InputGroupAddon align="inline-end">
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger
              render={
                <InputGroupButton variant="ghost" size="icon-xs" aria-label={t('af.pickDate')}>
                  <CalendarIcon />
                  <span className="sr-only">{t('af.pickDate')}</span>
                </InputGroupButton>
              }
            />
            <PopoverContent className="w-auto overflow-hidden p-0" align="end" alignOffset={-8} sideOffset={10}>
              <Calendar
                mode="single"
                selected={date}
                month={month}
                onMonthChange={setMonth}
                onSelect={(d) => {
                  onChange(d);
                  setValue(formatDate(d));
                  setOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>
        </InputGroupAddon>
      </InputGroup>
    </Field>
  );
}

function MoneyRange({ label, a, b, f, set, idp }: { label: string; a: 'amtMin' | 'feeMin'; b: 'amtMax' | 'feeMax'; f: AdvFilter; set: (p: Partial<AdvFilter>) => void; idp: string }) {
  const { t } = useI18n();
  return (
    <FieldSet className="gap-2">
      <FieldLegend variant="label">{label}</FieldLegend>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        {([a, b] as const).map((k, i) => (
          <InputGroup key={k} className={i ? 'col-start-3' : undefined}>
            <InputGroupAddon>
              <InputGroupText>$</InputGroupText>
            </InputGroupAddon>
            {/* ข้อยกเว้น Zero hints ที่ผู้ใช้สั่ง (2026-10-01): placeholder ต่ำสุด/สูงสุด — ไม่จองที่ในช่อง */}
            <InputGroupInput id={`${idp}-${k}`} placeholder={t(i ? 'af.max' : 'af.min')} aria-label={`${label} ${t(i ? 'af.max' : 'af.min')}`} type="text" inputMode="decimal" autoComplete="off" value={f[k]} onChange={(e) => set({ [k]: e.target.value })} />
          </InputGroup>
        ))}
        <span className="col-start-2 row-start-1 text-muted-foreground">–</span>
      </div>
    </FieldSet>
  );
}

function TokenSelect({ options, value, onChange }: { options: Array<{ symbol: string; count: number }>; value: string[]; onChange: (v: string[]) => void }) {
  const { t } = useI18n();
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" className="w-full justify-between font-normal" aria-label={t('af.token')} />}>
        <span className="truncate">{value.length ? value.join(', ') : t('af.allTokens')}</span>
        <ChevronDownIcon data-icon="inline-end" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandInput aria-label={t('af.token')} />
          <CommandList>
            <CommandEmpty>{t('af.noToken')}</CommandEmpty>
            <CommandGroup>
              {options.map((o) => {
                const on = value.includes(o.symbol);
                return (
                  <CommandItem key={o.symbol} value={o.symbol} data-checked={on} onSelect={() => onChange(on ? value.filter((x) => x !== o.symbol) : [...value, o.symbol])}>
                    {/* ชื่อกินที่ที่เหลือ (ชิด start) — ตัวเลขชิด end ก่อนเครื่องหมายถูก; ห้ามใช้ ml-auto คู่กับ CheckIcon ที่ ml-auto อยู่แล้ว (จะแบ่งที่ว่างกันจนเลขลอยกลาง) */}
                    <span className="min-w-0 flex-1 truncate">{o.symbol}</span>
                    <span className="text-muted-foreground tabular-nums">{o.count}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function Form({ f, set, tokens, cols, idp }: { f: AdvFilter; set: (p: Partial<AdvFilter>) => void; tokens: Array<{ symbol: string; count: number }>; cols: 1 | 2; idp: string }) {
  const { t } = useI18n();
  const toggle = <K extends 'dir' | 'status' | 'date'>(k: K, opts: Array<[AdvFilter[K], string]>, extra?: (v: AdvFilter[K]) => Partial<AdvFilter>) => (
    <ToggleGroup variant="outline" size="sm" className="flex-wrap" value={[f[k]]} onValueChange={(v: string[]) => v[0] && set({ [k]: v[0], ...(extra?.(v[0] as AdvFilter[K]) ?? {}) })} aria-label={t(`af.${k}`)}>
      {opts.map(([v, l]) => (
        <ToggleGroupItem key={v} value={v}>
          {l}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
  return (
    <FieldGroup className={cols === 2 ? 'grid grid-cols-2 gap-5' : 'grid grid-cols-1 gap-5'}>
      <FieldSet className="gap-2">
        <FieldLegend variant="label">{t('af.dir')}</FieldLegend>
        {toggle('dir', [['all', t('af.all')], ['in', t('af.in')], ['out', t('af.out')]])}
      </FieldSet>
      <FieldSet className="gap-2">
        <FieldLegend variant="label">{t('af.status')}</FieldLegend>
        {toggle('status', [['all', t('af.all')], ['ok', t('af.ok')], ['failed', t('af.failed')]])}
      </FieldSet>
      <FieldSet className="col-span-full gap-2">
        <FieldLegend variant="label">{t('af.date')}</FieldLegend>
        {toggle(
          'date',
          [
            ['24h', t('af.preset.24h')],
            ['7d', t('af.preset.7d')],
            ['30d', t('af.preset.30d')],
            ['all', t('af.preset.all')],
            ['custom', t('af.preset.custom')],
          ],
          (v) => (v === 'custom' ? {} : { from: undefined, to: undefined }),
        )}
        {f.date === 'custom' && (
          <div className={cols === 2 ? 'grid grid-cols-2 gap-3' : 'grid grid-cols-1 gap-3'}>
            <DateInput id={`${idp}-from`} label={t('af.from')} date={f.from} onChange={(d) => set({ from: d })} />
            <DateInput id={`${idp}-to`} label={t('af.to')} date={f.to} onChange={(d) => set({ to: d })} />
          </div>
        )}
      </FieldSet>
      <MoneyRange label={t('af.amount')} a="amtMin" b="amtMax" f={f} set={set} idp={idp} />
      <MoneyRange label={t('af.fee')} a="feeMin" b="feeMax" f={f} set={set} idp={idp} />
      <Field>
        <FieldLabel>{t('af.token')}</FieldLabel>
        <TokenSelect options={tokens} value={f.tokens} onChange={(v) => set({ tokens: v })} />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${idp}-cp`}>{t('af.counterparty')}</FieldLabel>
        <Input id={`${idp}-cp`} autoComplete="off" spellCheck={false} value={f.counterparty} onChange={(e) => set({ counterparty: e.target.value })} />
      </Field>
      <Field orientation="horizontal" className="col-span-full">
        <FieldLabel htmlFor={`${idp}-priced`} className="font-normal">
          {t('af.priced')}
        </FieldLabel>
        <Switch id={`${idp}-priced`} checked={f.priced} onCheckedChange={(v) => set({ priced: v })} />
      </Field>
    </FieldGroup>
  );
}

/* ---------- ปุ่ม + แผง ---------- */

export function AdvancedFilterButton({ value, onChange, rows, countFor }: { value: AdvFilter; onChange: (f: AdvFilter) => void; rows: TxRow[]; countFor: (f: AdvFilter) => number }) {
  const { t } = useI18n();
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const set = (p: Partial<AdvFilter>) => setDraft((d) => ({ ...d, ...p }));
  const n = useChips(value).length;
  const tokens = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of rows) for (const s of new Set(r.moves.filter((m) => m.amount !== 0).map((m) => m.symbol))) c.set(s, (c.get(s) ?? 0) + 1);
    return [...c].map(([symbol, count]) => ({ symbol, count })).sort((a, b) => b.count - a.count);
  }, [rows]);
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
      <Button variant="link" size="sm" className="px-0" onClick={() => setDraft(ADV_EMPTY)}>
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
              <Form f={draft} set={set} tokens={tokens} cols={1} idp="afm" />
            </div>
            <DrawerFooter className="flex-row border-t">
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
      <PopoverContent align="start" sideOffset={8} className="w-[560px] max-w-[calc(100vw-2rem)] gap-4 p-5">
        <PopoverHeader className="flex-row items-center justify-between">{head(PopoverTitle)}</PopoverHeader>
        <Form f={draft} set={set} tokens={tokens} cols={2} idp="afd" />
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

/** ชิปของตัวกรองที่ใช้อยู่ — กดกากบาทเอาออกทีละตัว */
export function AdvancedFilterChips({ value, onChange }: { value: AdvFilter; onChange: (f: AdvFilter) => void }) {
  const { t } = useI18n();
  const list = useChips(value);
  if (!list.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {list.map(([k, l]) => (
        <Badge key={k} variant="secondary" className="h-7 gap-1 pr-1 pl-2.5">
          {l}
          <Button variant="ghost" size="icon-xs" aria-label={t('af.remove', { what: l })} onClick={() => onChange(clearKey(value, k))}>
            <XIcon />
          </Button>
        </Badge>
      ))}
      <Button variant="link" size="sm" className="text-muted-foreground" onClick={() => onChange(ADV_EMPTY)}>
        {t('af.clear')}
      </Button>
    </div>
  );
}
