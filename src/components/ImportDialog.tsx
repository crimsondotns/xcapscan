import { useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { useStore } from '../store';
import { ImportError, readWalletFile, SAMPLE_CSV, type ImportRow } from '../importWallets';
import { downloadText } from '../download';
import { DownloadIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog } from './Dialog';
import { useToast } from './Toast';

export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { wallets, addWallets } = useStore();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function reset() {
    setRows(null);
    setErr(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      setRows(await readWalletFile(file, new Set(wallets.map((w) => w.address))));
    } catch (e) {
      setRows(null);
      setErr(e instanceof ImportError && e.kind === 'noHeader' ? t('import.noHeader') : t('import.readFail'));
    } finally {
      setBusy(false);
    }
  }

  const ok = rows?.filter((r) => r.status === 'ok') ?? [];

  function submit() {
    const n = addWallets(ok);
    toast(t('import.done', { n }));
    reset();
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title={t('import.title')}
    >
      <FieldGroup>
        <Field data-invalid={err ? true : undefined}>
          <FieldLabel htmlFor="import-file">{t('import.file')}</FieldLabel>
          <Input id="import-file" ref={fileRef} name="file" type="file" accept=".csv,.xlsx,.xlsm,.xls,text/csv" onChange={(e) => void pick(e.target.files?.[0])} />
          <FieldDescription>{t('import.columns')}</FieldDescription>
          <Button type="button" variant="link" className="self-start px-0" onClick={() => downloadText('xcapscan-wallets-sample.csv', SAMPLE_CSV, 'text/csv')}>
            <DownloadIcon data-icon="inline-start" />
            {t('import.sample')}
          </Button>
          {busy && (
            <FieldDescription aria-live="polite" className="flex items-center gap-2">
              <Spinner />
              {t('import.reading')}
            </FieldDescription>
          )}
          {err && <FieldError aria-live="polite">{err}</FieldError>}
        </Field>

        {rows && (
          <Field>
            <FieldDescription aria-live="polite">{t('import.preview', { ok: ok.length, bad: rows.length - ok.length })}</FieldDescription>
            <div className="max-h-72 overflow-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">{t('import.col.label')}</TableHead>
                    <TableHead scope="col">{t('import.col.address')}</TableHead>
                    <TableHead scope="col">{t('import.col.status')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r, i) => (
                    <TableRow key={i} className={r.status !== 'ok' ? 'text-muted-foreground' : undefined}>
                      <TableCell>{r.label || '—'}</TableCell>
                      <TableCell className="max-w-56 truncate">{r.address || '—'}</TableCell>
                      <TableCell>
                        <Badge variant={r.status === 'ok' ? 'secondary' : 'destructive'}>{t(r.status === 'ok' ? 'import.row.ok' : r.status === 'dupe' ? 'import.row.dupe' : 'import.row.bad')}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Field>
        )}

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            {t('dialog.cancel')}
          </Button>
          <Button type="button" disabled={!ok.length} onClick={submit}>
            {t('import.submit', { n: ok.length })}
          </Button>
        </div>
      </FieldGroup>
    </Dialog>
  );
}
