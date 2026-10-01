/**
 * ตั้งค่า — สองแท็บ: ทั่วไป (การแสดงผล + ป้ายบนสลิป) และ ข้อมูล (สำรอง/กู้คืน + สรุปแหล่งข้อมูล)
 * แหล่งข้อมูล/เชน/การเชื่อมต่อ มาจากค่าที่ฝังตอน build แล้ว (ดู docs/build-config.md) จึงเหลือเป็นบรรทัดสรุปอ่านอย่างเดียว
 */
import { useState, type ReactNode } from 'react';
import { useI18n, type MessageKey } from '../i18n';
import { SLIP_FIELDS, snapshot, useStore } from '../store';
import { Dialog } from './Dialog';
import { DialogTabs, type TabDef } from './DialogTabs';
import { Dropdown } from './Dropdown';
import { DownloadIcon, LockIcon, UploadIcon } from 'lucide-react';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useToast } from './Toast';
import { backupFilename, buildBackup, mergeData, readBackup, BackupError, type PortableData } from '../backup';
import { decryptJson, encryptJson, keyFromPassphrase, randomSalt } from '../crypto';
import { downloadText } from '../download';

type Tab = 'general' | 'data';
type Mode = 'merge' | 'replace';
type ExportMode = 'plain' | 'encrypted';

const TABS = (t: (k: MessageKey) => string): Array<TabDef<Tab>> => [
  { id: 'general', label: t('settings.tab.general'), icon: 'settings' },
  { id: 'data', label: t('settings.tab.data'), icon: 'layers' },
];

/** หนึ่งแถวของหน้าตั้งค่า: ชื่อ (+คำอธิบาย) ซ้าย ตัวควบคุมขวา */
function Row({ title, desc, htmlFor, children }: { title: string; desc?: string; htmlFor?: string; children: ReactNode }) {
  return (
    <Field orientation="horizontal">
      <FieldContent>
        <FieldLabel htmlFor={htmlFor}>{title}</FieldLabel>
        {desc && <FieldDescription>{desc}</FieldDescription>}
      </FieldContent>
      {children}
    </Field>
  );
}

function Group({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <FieldSet>
      <FieldLegend>{title}</FieldLegend>
      <FieldGroup className="gap-4">{children}</FieldGroup>
      {note && <FieldDescription>{note}</FieldDescription>}
    </FieldSet>
  );
}

function PassField({ id, label, value, onChange, autoComplete, autoFocus, onEnter, error }: { id: string; label: string; value: string; onChange: (v: string) => void; autoComplete: string; autoFocus?: boolean; onEnter?: () => void; error?: string | null }) {
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        aria-invalid={error ? true : undefined}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onEnter) onEnter();
        }}
      />
      {error && <FieldError>{error}</FieldError>}
    </Field>
  );
}

/** ข้อมูลไฟล์ที่อ่านมาก่อนรู้ว่าเป็น encrypted หรือไม่ */
type PendingImport = { file: File; salt?: string; payload?: string };

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const { wallets, settings, setPageSize, setHideScam, setSlipShow, restore } = useStore();
  const [tab, setTab] = useState<Tab>('general');

  // Export
  const [exportMode, setExportMode] = useState<ExportMode>('plain');
  const [encOpen, setEncOpen] = useState(false);
  const [encPass, setEncPass] = useState('');
  const [encConfirm, setEncConfirm] = useState('');
  const [encErr, setEncErr] = useState<string | null>(null);

  // Import
  const [mode, setMode] = useState<Mode>('merge');
  const [importErr, setImportErr] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [decOpen, setDecOpen] = useState(false);
  const [decPass, setDecPass] = useState('');
  const [decErr, setDecErr] = useState<string | null>(null);

  const data = (): PortableData => snapshot();

  function exportPlain() {
    downloadText(backupFilename(), JSON.stringify(buildBackup(data()), null, 2));
    toast(t('account.exported'));
  }

  async function exportEncrypted(pass: string) {
    const salt = randomSalt();
    const payload = await encryptJson(await keyFromPassphrase(pass, salt), buildBackup(data()));
    downloadText(backupFilename(new Date(), true), JSON.stringify({ app: 'xcapscan', kind: 'backup-encrypted', v: 1, salt, payload }, null, 2));
    toast(t('account.exported'));
  }

  function handleExportClick() {
    if (exportMode === 'plain') {
      exportPlain();
      return;
    }
    setEncPass('');
    setEncConfirm('');
    setEncErr(null);
    setEncOpen(true);
  }

  function confirmEncrypt() {
    if (encPass.length < 8) {
      setEncErr(t('account.passTooShort'));
      return;
    }
    if (encPass !== encConfirm) {
      setEncErr(t('account.passMismatch'));
      return;
    }
    setEncOpen(false);
    void exportEncrypted(encPass);
  }

  /** นำเข้าข้อมูล (ไม่เข้ารหัส) — apply ทันที */
  async function applyImport(raw: unknown) {
    setImportErr(null);
    try {
      const incoming = readBackup(raw);
      if (mode === 'replace') {
        restore({ wallets: incoming.data.wallets, settings: { ...incoming.data.settings, endpoints: settings.endpoints, chainListUrl: settings.chainListUrl, chains: settings.chains } });
        toast(t('account.restored'));
      } else {
        const { data: merged, added } = mergeData(data(), incoming.data);
        restore(merged);
        toast(t('account.merged', { n: added.wallets }));
      }
    } catch (e) {
      setImportErr(e instanceof BackupError ? t(`account.err.${e.code}`) : t('account.err.shape'));
    }
  }

  /** ผู้ใช้เลือกไฟล์ → อ่าน → ตรวจว่าเข้ารหัสไหม → เปิด dialog หรือ import ทันที */
  async function handleFilePick(file: File) {
    setImportErr(null);
    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      setImportErr(t('account.err.shape'));
      return;
    }
    if (raw && typeof raw === 'object' && (raw as { kind?: string }).kind === 'backup-encrypted') {
      const { salt, payload } = raw as { salt: string; payload: string };
      setPending({ file, salt, payload });
      setDecPass('');
      setDecErr(null);
      setDecOpen(true);
      return;
    }
    await applyImport(raw);
  }

  /** ยืนยัน decrypt แล้ว import */
  async function confirmDecrypt() {
    if (!pending?.salt || !pending?.payload) return;
    if (decPass.length < 8) {
      setDecErr(t('account.passTooShort'));
      return;
    }
    try {
      const raw = await decryptJson(await keyFromPassphrase(decPass, pending.salt), pending.payload);
      setDecOpen(false);
      setPending(null);
      await applyImport(raw);
    } catch {
      setDecErr(t('account.err.shape'));
    }
  }

  return (
    <>
      <Dialog open={open} onClose={onClose} title={t('settings.title')} wide>
        <DialogTabs tabs={TABS(t)} active={tab} onChange={setTab} label={t('settings.title')}>
          {tab === 'general' && (
            <>
              <Group title={t('settings.display')}>
                <Row title={t('settings.pageSize')} desc={t('settings.pageSizeDesc')} htmlFor="set-page">
                  <Input
                    id="set-page"
                    name="pageSize"
                    type="text"
                    inputMode="numeric"
                    className="w-20 text-right tabular-nums"
                    value={settings.pageSize}
                    onChange={(e) => setPageSize(Math.min(200, Math.max(5, Number(e.target.value.replace(/\D/g, '')) || 0)))}
                    aria-label={t('settings.pageSize')}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </Row>
                <Row title={t('tx.hideScam')} desc={t('settings.hideScamDesc')} htmlFor="set-scam">
                  <Switch id="set-scam" checked={settings.hideScam} onCheckedChange={(v) => setHideScam(v)} />
                </Row>
              </Group>

              <Group title={t('settings.slip')} note={t('settings.slipNote')}>
                {SLIP_FIELDS.map((f) => (
                  <Row key={f} title={t(`slipField.${f}`)} htmlFor={`set-slip-${f}`}>
                    <Switch id={`set-slip-${f}`} checked={settings.slipShow[f]} onCheckedChange={(v) => setSlipShow(f, v)} />
                  </Row>
                ))}
              </Group>
            </>
          )}

          {tab === 'data' && (
            <>
              <Group title={t('account.data')} note={t('account.backupNote')}>
                <Row title={t('account.export')} desc={t('account.dataWhere', { wallets: wallets.length, sources: settings.endpoints.length })}>
                  <div className="flex shrink-0 gap-2">
                    <Dropdown
                      size="sm"
                      value={exportMode}
                      onChange={setExportMode}
                      label={t('account.export')}
                      options={[
                        { value: 'plain' as const, label: t('account.export') },
                        { value: 'encrypted' as const, label: t('account.exportEncrypted') },
                      ]}
                    />
                    <Button size="sm" onClick={handleExportClick}>
                      {exportMode === 'encrypted' ? <LockIcon data-icon="inline-start" /> : <DownloadIcon data-icon="inline-start" />}
                      {t('account.export')}
                    </Button>
                  </div>
                </Row>
                <Row title={t('account.import')} desc={t('account.importMode')}>
                  <div className="flex shrink-0 gap-2">
                    <Dropdown
                      size="sm"
                      value={mode}
                      onChange={setMode}
                      label={t('account.importMode')}
                      options={[
                        { value: 'merge' as const, label: t('account.merge') },
                        { value: 'replace' as const, label: t('account.replace') },
                      ]}
                    />
                    <Button size="sm" variant="outline" nativeButton={false} render={<label />}>
                      <UploadIcon data-icon="inline-start" />
                      {t('account.import')}
                      <input
                        type="file"
                        accept="application/json,.json"
                        className="sr-only"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void handleFilePick(f);
                          e.target.value = '';
                        }}
                      />
                    </Button>
                  </div>
                </Row>
              </Group>
              {importErr && (
                <Alert variant="destructive">
                  <AlertTitle>{importErr}</AlertTitle>
                </Alert>
              )}
            </>
          )}
        </DialogTabs>
        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>
            {t('dialog.close')}
          </Button>
        </div>
      </Dialog>

      {/* Dialog ใส่รหัสผ่านสำหรับ Export encrypted */}
      <Dialog open={encOpen} onClose={() => setEncOpen(false)} title={t('account.exportEncrypted')}>
        <FieldGroup>
          <PassField id="enc-pass" label={t('account.passphrase')} value={encPass} autoComplete="new-password" autoFocus onChange={(v) => { setEncPass(v); setEncErr(null); }} />
          <PassField id="enc-confirm" label={t('account.passConfirm')} value={encConfirm} autoComplete="new-password" error={encErr} onChange={(v) => { setEncConfirm(v); setEncErr(null); }} onEnter={confirmEncrypt} />
          <FieldDescription>{t('account.passWarn')}</FieldDescription>
          <FieldDescription>{t('account.passHint')}</FieldDescription>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEncOpen(false)}>
              {t('dialog.close')}
            </Button>
            <Button onClick={confirmEncrypt} disabled={encPass.length < 8 || encPass !== encConfirm}>
              <LockIcon data-icon="inline-start" />
              {t('account.encrypt')}
            </Button>
          </div>
        </FieldGroup>
      </Dialog>

      {/* Dialog ใส่รหัสผ่านสำหรับ Import encrypted — เปิดอัตโนมัติเมื่อเจอไฟล์เข้ารหัส */}
      <Dialog
        open={decOpen}
        onClose={() => {
          setDecOpen(false);
          setPending(null);
          setDecPass('');
          setDecErr(null);
        }}
        title={t('account.decryptTitle')}
      >
        <FieldGroup>
          <PassField id="dec-pass" label={t('account.passphrase')} value={decPass} autoComplete="current-password" autoFocus error={decErr} onChange={(v) => { setDecPass(v); setDecErr(null); }} onEnter={() => void confirmDecrypt()} />
          <FieldDescription>{t('account.decryptHint')}</FieldDescription>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setDecOpen(false);
                setPending(null);
                setDecPass('');
                setDecErr(null);
              }}
            >
              {t('dialog.cancel')}
            </Button>
            <Button onClick={() => void confirmDecrypt()} disabled={decPass.length < 8}>
              <LockIcon data-icon="inline-start" />
              {t('account.decrypt')}
            </Button>
          </div>
        </FieldGroup>
      </Dialog>
    </>
  );
}