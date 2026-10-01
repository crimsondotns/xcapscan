/**
 * กลุ่มกระเป๋า — แถบซ้ายบนหน้าแดชบอร์ด และเมนูบนหัวเว็บเมื่ออยู่หน้าย่อย (แถบซ้ายหายไป)
 * ทั้งสองแบบใช้รายการชุดเดียวกัน จึงไม่มีทางเลื่อนไม่ตรงกัน
 */
import { chainGroup, matchesGroup, tagGroup, tagsOf, familiesOf, type GroupId, type WalletInfo } from '../groups';
import { chainOf, type ChainMap } from '../chains';
import { useI18n } from '../i18n';
import type { Family, Wallet } from '../store';
import { Icon } from './Icon';
import { Logo } from './Logo';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useIsMobile } from '@/hooks/useIsMobile';
import { ChevronDownIcon } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

export interface GroupNavProps {
  wallets: Wallet[];
  infoOf: (w: Wallet) => WalletInfo;
  group: GroupId;
  onChange: (g: GroupId) => void;
  chains: ChainMap;
}

interface Item {
  id: GroupId;
  label: string;
  count: number;
  logo?: { src: string | null; name: string };
}

/** โลโก้แทนตระกูลเชน — เอาจาก chain list ถ้ามี ไม่มีก็วงกลมตัวอักษร */
function familyLogo(chains: ChainMap, family: Family, name: string): { src: string | null; name: string } {
  const ids = family === 'sol' ? ['sol', 'solana'] : ['eth', 'ethereum'];
  for (const id of ids) {
    const c = chainOf(chains, id);
    if (c?.logo) return { src: c.logo, name };
  }
  return { src: null, name };
}

function useSections({ wallets, infoOf, chains }: Omit<GroupNavProps, 'group' | 'onChange'>): { fixed: Item[]; tags: Item[]; families: Item[] } {
  const { t } = useI18n();
  const count = (g: GroupId) => wallets.filter((w) => matchesGroup(g, w, infoOf(w))).length;
  const fixed: Item[] = [{ id: 'all', label: t('group.all'), count: wallets.length }];
  const tags: Item[] = tagsOf(wallets).map((tag) => ({ id: tagGroup(tag), label: tag, count: count(tagGroup(tag)) }));
  const families: Item[] = familiesOf(wallets).map((f) => {
    const label = t(`family.${f}`);
    return { id: chainGroup(f), label, count: count(chainGroup(f)), logo: familyLogo(chains, f, label) };
  });
  return { fixed, tags, families };
}

/** ป้ายของกลุ่มที่เลือกอยู่ (ใช้บนหัวข้อและ breadcrumb) */
export function useGroupLabel(wallets: Wallet[], group: GroupId): string {
  const { t } = useI18n();
  if (group.startsWith('tag:')) return group.slice(4);
  if (group.startsWith('chain:')) return t(group.slice(6) === 'sol' ? 'family.sol' : 'family.erc20');
  return t('group.all');
}

const ItemLabel = ({ item }: { item: Item }) =>
  item.logo ? (
    <span className="opt">
      <Logo src={item.logo.src} name={item.logo.name} size={18} />
      {item.label}
    </span>
  ) : (
    <>{item.label}</>
  );

/** แถบซ้ายของหน้าแดชบอร์ด */
export function GroupRail(props: GroupNavProps) {
  const { t } = useI18n();
  const { fixed, tags, families } = useSections(props);
  const mobile = useIsMobile();
  if (mobile) return <GroupSelect {...props} sections={{ fixed, tags, families }} />;
  const btn = (item: Item) => (
    <button key={item.id} type="button" aria-selected={props.group === item.id} onClick={() => props.onChange(item.id)}>
      <ItemLabel item={item} />
      <span className="count">{item.count}</span>
    </button>
  );
  return (
    <nav className="rail" aria-label={t('group.nav')}>
      {fixed.map(btn)}
      {tags.length > 0 && <div className="rail-head">{t('group.tags')}</div>}
      {tags.map(btn)}
      {families.length > 1 && <div className="rail-head">{t('group.chains')}</div>}
      {families.length > 1 && families.map(btn)}
    </nav>
  );
}

/** มือถือ (ผู้ใช้ 2026-10-01): แถบซ้ายเป็น dropdown เดียว แบ่งหมวด Tags / Chains */
function GroupSelect({ group, onChange, sections }: GroupNavProps & { sections: { fixed: Item[]; tags: Item[]; families: Item[] } }) {
  const { t } = useI18n();
  const { fixed, tags, families } = sections;
  const all = [...fixed, ...tags, ...families];
  const current = all.find((i) => i.id === group) ?? fixed[0]!;
  const opt = (item: Item) => (
    <SelectItem key={item.id} value={item.id}>
      <ItemLabel item={item} />
      <span className="ml-auto text-muted-foreground tabular-nums">{item.count}</span>
    </SelectItem>
  );
  return (
    <nav aria-label={t('group.nav')}>
      <Select value={group} onValueChange={(v) => v != null && onChange(v as GroupId)}>
        <SelectTrigger aria-label={t('group.nav')} className="w-full">
          <SelectValue>
            {() => (
              <>
                <ItemLabel item={current} />
                <span className="ml-auto text-muted-foreground tabular-nums">{current.count}</span>
              </>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          <SelectGroup>{fixed.map(opt)}</SelectGroup>
          {tags.length > 0 && (
            <>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>{t('group.tags')}</SelectLabel>
                {tags.map(opt)}
              </SelectGroup>
            </>
          )}
          {families.length > 1 && (
            <>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>{t('group.chains')}</SelectLabel>
                {families.map(opt)}
              </SelectGroup>
            </>
          )}
        </SelectContent>
      </Select>
    </nav>
  );
}

function Menu({ label, items, group, onChange }: { label: string; items: Item[]; group: GroupId; onChange: (g: GroupId) => void }) {
  if (!items.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="sm" />}>
        {label}
        <ChevronDownIcon data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuRadioGroup value={group} onValueChange={(v: string) => onChange(v as GroupId)}>
            {items.map((item) => (
              <DropdownMenuRadioItem key={item.id} value={item.id}>
                <ItemLabel item={item} />
                <span className="ml-auto pr-5 text-muted-foreground tabular-nums">{item.count}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** เมนูบนหัวเว็บ (หน้าย่อย) — เนื้อหาเดียวกับแถบซ้าย เปิดด้วยการชี้เมาส์หรือโฟกัส */
export function GroupMenubar(props: GroupNavProps) {
  const { t } = useI18n();
  const { fixed, tags, families } = useSections(props);
  return (
    <nav className="menubar" aria-label={t('group.nav')}>
      <Menu label={t('group.wallets')} items={fixed} group={props.group} onChange={props.onChange} />
      <Menu label={t('group.tags')} items={tags} group={props.group} onChange={props.onChange} />
      {families.length > 1 && <Menu label={t('group.chains')} items={families} group={props.group} onChange={props.onChange} />}
    </nav>
  );
}
