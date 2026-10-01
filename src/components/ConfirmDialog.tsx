/** ไดอะล็อกยืนยัน — shadcn AlertDialog ใช้กับ action ที่ย้อนกลับไม่ได้ (ลบกระเป๋า / ล้างทั้งหมด) */
import { useI18n } from '../i18n';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export interface ConfirmState {
  type: 'deleteWallet' | 'deleteSelected' | 'clearAll';
  title: string;
  message: string;
  walletId: string | null;
}

export function ConfirmDialog({ state, onConfirm, onCancel }: { state: ConfirmState | null; onConfirm: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  return (
    <AlertDialog open={state !== null} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{state?.title}</AlertDialogTitle>
          <AlertDialogDescription>{state?.message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('dialog.cancel')}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            {t('dialog.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
