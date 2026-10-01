/** สลับธีม — shadcn ToggleGroup สองช่อง (สว่าง/มืด) */
import { MoonIcon, SunIcon } from 'lucide-react';
import { useI18n } from '../i18n';
import { useTheme, type Theme } from '../theme';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

export function ThemeToggle() {
  const { t } = useI18n();
  const [theme, setTheme] = useTheme();
  return (
    <ToggleGroup variant="outline" size="sm" value={[theme]} onValueChange={(v: string[]) => v[0] && setTheme(v[0] as Theme)} aria-label={t('theme.label')}>
      <ToggleGroupItem value="light" title={t('theme.light')} aria-label={t('theme.light')}>
        <SunIcon />
      </ToggleGroupItem>
      <ToggleGroupItem value="dark" title={t('theme.dark')} aria-label={t('theme.dark')}>
        <MoonIcon />
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
