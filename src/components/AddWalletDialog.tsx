import { useState, type FormEvent } from 'react';
import { useI18n } from '../i18n';
import { parseAddress, useStore } from '../store';
import { Dialog } from './Dialog';
import { useToast } from './Toast';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

export function AddWalletDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { wallets, addWallets } = useStore();
  const { toast } = useToast();
  const [label, setLabel] = useState('');
  const [address, setAddress] = useState('');
  const [err, setErr] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const p = parseAddress(address);
    if (!p) return setErr(t('add.badAddress'));
    if (wallets.some((w) => w.address === p.address)) return setErr(t('add.dupe'));
    addWallets([{ label, address: p.address }]);
    toast(t('add.done'));
    setLabel('');
    setAddress('');
    setErr(null);
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} title={t('add.title')}>
      <form onSubmit={submit}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="add-label">{t('add.label')}</FieldLabel>
            <Input id="add-label" name="label" value={label} onChange={(e) => setLabel(e.target.value)} autoComplete="off" maxLength={64} />
          </Field>
          <Field data-invalid={err ? true : undefined}>
            <FieldLabel htmlFor="add-address">{t('add.address')}</FieldLabel>
            <Input
              id="add-address"
              name="address"
              value={address}
              onChange={(e) => {
                setAddress(e.target.value);
                setErr(null);
              }}
              autoComplete="off"
              spellCheck={false}
              required
              aria-invalid={err ? true : undefined}
            />
            {err && <FieldError aria-live="polite">{err}</FieldError>}
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('dialog.cancel')}
            </Button>
            <Button type="submit">{t('add.submit')}</Button>
          </div>
        </FieldGroup>
      </form>
    </Dialog>
  );
}
