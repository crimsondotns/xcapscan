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

function Menu({ label, items, group, onChange }: { label: string; items: Item[]; group: GroupId; onChange: (g: GroupId) => void }) {
  if (!items.length) return null;
  return (
    <div className="menu">
      <button type="button" className="btn btn-sm" aria-haspopup="true">
        <span className="dd-text">{label}</span>
        <Icon name="chevronDown" className="dd-chev" />
      </button>
      <ul className="dd-panel" role="menu" aria-label={label}>
        {items.map((item) => (
          <li key={item.id} role="none">
            <button type="button" role="menuitem" className="dd-item" aria-selected={group === item.id} onClick={() => onChange(item.id)}>
              <span className="dd-item-text">
                <ItemLabel item={item} />
              </span>
              <small>{item.count}</small>
            </button>
          </li>
        ))}
      </ul>
    </div>
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
