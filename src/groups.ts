/**
 * กลุ่มกระเป๋าในแถบซ้าย (และเมนูบนหัวหน้าย่อย) — ตรรกะล้วน เทสต์ได้
 * id ของกลุ่ม: คงที่ 'all' หรือ 'tag:<แท็ก>' / 'chain:<ตระกูล>'
 */
import type { Family, Wallet } from './store';

export type GroupId = string;

export const FIXED_GROUPS = ['all'] as const;
export type FixedGroup = (typeof FIXED_GROUPS)[number];

/** ข้อมูลที่กลุ่มต้องรู้เกี่ยวกับกระเป๋าหนึ่งใบ (มาจาก feed) */
export interface WalletInfo {
  loaded: boolean;
  /** เวลาธุรกรรมล่าสุด (วินาที) — null = ไม่มี/ยังไม่โหลด */
  last: number | null;
}

export const tagGroup = (tag: string): GroupId => `tag:${tag}`;
export const chainGroup = (family: Family): GroupId => `chain:${family}`;

export function matchesGroup(group: GroupId, w: Wallet, _info?: WalletInfo, _now?: number): boolean {
  if (group === 'all') return true;
  if (group.startsWith('tag:')) return (w.tags ?? []).includes(group.slice(4));
  if (group.startsWith('chain:')) return w.family === group.slice(6);
  return true;
}

/** แท็กทั้งหมดที่ผู้ใช้ตั้งไว้ เรียงตามตัวอักษร (ไม่มีแท็ก = ไม่นับ) */
export function tagsOf(wallets: Wallet[]): string[] {
  return [...new Set(wallets.flatMap((w) => w.tags ?? []))].sort((a, b) => a.localeCompare(b));
}

/** ตระกูลเชนที่มีกระเป๋าอยู่จริง — ไม่โชว์กลุ่มว่าง */
export function familiesOf(wallets: Wallet[]): Family[] {
  return (['erc20', 'sol'] as const).filter((f) => wallets.some((w) => w.family === f));
}

/** กลุ่มที่เลือกอยู่ยังมีอยู่ไหม (ลบแท็กสุดท้ายทิ้ง → กลับไป 'all') */
export function groupExists(group: GroupId, wallets: Wallet[]): boolean {
  if ((FIXED_GROUPS as readonly string[]).includes(group)) return true;
  if (group.startsWith('tag:')) return tagsOf(wallets).includes(group.slice(4));
  if (group.startsWith('chain:')) return familiesOf(wallets).includes(group.slice(6) as Family);
  return false;
}
