/** ตรวจสลิป — วางรหัส (หรือเปิดจากลิงก์แชร์ที่พกข้อมูลมา) → แฮชใหม่เทียบรหัส แล้วโชว์สลิปที่ตรวจแล้ว */
import { useEffect, useState, type FormEvent } from 'react';
import { useI18n } from '../i18n';
import { normalizeCode, verifySlip, type SlipData, type SlipRecord, type Verdict } from '../slip';
import { Dialog } from './Dialog';
import { ShieldCheckIcon, TriangleAlertIcon, XIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { SlipPicture, useSlipImage } from './SlipView';

export function VerifyDialog({ open, initial, onClose, seen }: { open: boolean; initial: { code: string; data: SlipData | null } | null; onClose: () => void; seen: (hash: string) => boolean }) {
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ verdict: Verdict; rec: SlipRecord | null; stored: boolean } | null>(null);
  const img = useSlipImage(result?.rec ?? null, result?.verdict === 'valid' ? 'verify' : null);

  async function run(c: string, data: SlipData | null) {
    const r = await verifySlip(c, data);
    setResult({ verdict: r.verdict, rec: r.data ? { code: c, data: r.data } : null, stored: r.stored });
  }
  useEffect(() => {
    if (!open) {
      setResult(null);
      setErr(null);
      return;
    }
    if (initial) {
      setCode(initial.code);
      void run(initial.code, initial.data);
    }
  }, [open, initial]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const c = normalizeCode(code);
    if (!c) return setErr(t('slip.badCode'));
    setErr(null);
    void run(c, initial?.code === c ? initial.data : null);
  }

  return (
    <Dialog open={open} onClose={onClose} title={t('slip.verify')}>
      <form onSubmit={submit} noValidate>
        <Field data-invalid={err ? true : undefined}>
          <FieldLabel htmlFor="slip-code">{t('slip.code')}</FieldLabel>
          <div className="flex gap-2">
            <Input
              id="slip-code"
              name="code"
              type="text"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setErr(null);
              }}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={err ? true : undefined}
            />
            <Button type="submit" disabled={code.trim() === ''}>
              {t('slip.verifyBtn')}
            </Button>
          </div>
          {err && <FieldError aria-live="polite">{err}</FieldError>}
        </Field>
      </form>
      {result && (
        <div className="flex flex-col gap-4" aria-live="polite">
          <Alert variant={result.verdict === 'valid' ? 'default' : 'destructive'}>
            {result.verdict === 'valid' ? <ShieldCheckIcon /> : result.verdict === 'tampered' ? <TriangleAlertIcon /> : <XIcon />}
            <AlertTitle>{t(`slip.verdict.${result.verdict}`)}</AlertTitle>
            <AlertDescription>
              {result.verdict === 'unknown' ? t('slip.unknownHint') : result.rec && seen(result.rec.data.hash) ? t('slip.seenHint') : result.stored ? t('slip.storedHint') : t('slip.linkHint')}
            </AlertDescription>
          </Alert>
          {result.rec && (
            <div className="grid min-h-40 place-items-center" aria-busy={!img}>
              {img ? <SlipPicture img={img} alt={t('slip.title')} name={`xcapscan-slip-${result.rec.code}.png`} /> : <Spinner />}
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
