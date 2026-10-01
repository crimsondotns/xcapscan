/**
 * แท็กของกระเป๋า — ใส่ได้หลายอันต่อหนึ่งกระเป๋า
 * พิมพ์ชื่อแล้วกด Enter เพื่อเพิ่ม, กดแท็กที่เคยใช้เพื่อสลับใส่/เอาออก, กดกากบาทบนเม็ดเพื่อถอด
 * บันทึกทันทีที่แก้ ไม่ต้องกดยืนยัน (เหมือนสวิตช์อื่นๆ ในแอป) ปิดด้วย Esc หรือปุ่มปิด
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useI18n } from '../i18n';
import { cleanTags, useStore, type Wallet } from '../store';
import { tagsOf } from '../groups';
import { Dialog } from './Dialog';
import { PlusIcon, XIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

const MAX_LEN = 32;

export function TagDialog({ open, wallet, onClose }: { open: boolean; wallet: Wallet; onClose: () => void }) {
  const { t } = useI18n();
  const { wallets, setWalletTags } = useStore();
  const [draft, setDraft] = useState('');
  const tags = useMemo(() => wallet.tags ?? [], [wallet.tags]);
  /* แท็กที่กระเป๋าใบอื่นใช้อยู่ — กดใส่ได้เลย จะได้ไม่พิมพ์ผิดจนกลายเป็นคนละกลุ่ม */
  const known = useMemo(() => tagsOf(wallets).filter((x) => !tags.includes(x)), [wallets, tags]);

  useEffect(() => {
    if (open) setDraft('');
  }, [open]);

  const set = (next: string[]) => setWalletTags(wallet.id, cleanTags(next));

  function add(e: FormEvent) {
    e.preventDefault();
    const v = draft.trim();
    if (!v) return;
    set([...tags, v]);
    setDraft('');
  }

  return (
    <Dialog open={open} onClose={onClose} title={t('tags.title', { label: wallet.label })}>
      <FieldGroup>
        <Field>
          <FieldLabel>{t('tags.current')}</FieldLabel>
          {tags.length === 0 ? (
            <FieldDescription>{t('wallets.noTag')}</FieldDescription>
          ) : (
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="h-7 gap-1 pr-1 pl-2.5">
                  {tag}
                  <Button variant="ghost" size="icon-xs" onClick={() => set(tags.filter((x) => x !== tag))} aria-label={t('tags.remove', { tag })} title={t('tags.remove', { tag })}>
                    <XIcon />
                  </Button>
                </Badge>
              ))}
            </div>
          )}
        </Field>

        <form onSubmit={add}>
          <Field>
            <FieldLabel htmlFor="tag-new">{t('tags.add')}</FieldLabel>
            <div className="flex gap-2">
              <Input id="tag-new" name="tag" value={draft} onChange={(e) => setDraft(e.target.value)} autoComplete="off" maxLength={MAX_LEN} />
              <Button type="submit" variant="outline" disabled={draft.trim() === '' || tags.includes(draft.trim())}>
                <PlusIcon data-icon="inline-start" />
                {t('tags.addBtn')}
              </Button>
            </div>
            <FieldDescription>{t('wallets.tagHint')}</FieldDescription>
          </Field>
        </form>

        {known.length > 0 && (
          <Field>
            <FieldLabel>{t('tags.known')}</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {known.map((tag) => (
                <Button key={tag} type="button" variant="outline" size="sm" onClick={() => set([...tags, tag])}>
                  <PlusIcon data-icon="inline-start" />
                  {tag}
                </Button>
              ))}
            </div>
          </Field>
        )}
      </FieldGroup>

      <div className="flex justify-end">
        <Button type="button" variant="outline" onClick={onClose}>
          {t('dialog.close')}
        </Button>
      </div>
    </Dialog>
  );
}
