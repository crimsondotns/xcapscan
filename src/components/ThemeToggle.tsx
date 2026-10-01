/** สลับธีม — ปุ่มเดียว: กดแล้วสลับสว่าง ⇄ มืด; ไอคอนบอกธีมที่จะเปลี่ยนไป */
import { MoonIcon, SunIcon } from 'lucide-react';
import { useI18n } from '../i18n';
import { useTheme } from '../theme';
import { Button } from '@/components/ui/button';

export function ThemeToggle() {
  const { t } = useI18n();
  const [theme, setTheme] = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  const label = t(next === 'dark' ? 'theme.dark' : 'theme.light');
  return (
    <Button variant="ghost" size="icon" onClick={() => setTheme(next)} aria-label={label} title={label}>
      {next === 'dark' ? <MoonIcon /> : <SunIcon />}
    </Button>
  );
}
