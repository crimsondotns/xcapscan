/** สลับธีม — segmented control ทรง pill สองช่อง (สว่าง/มืด) */
import { useI18n } from '../i18n';
import { useTheme, type Theme } from '../theme';
import { Icon } from './Icon';

const OPTIONS: Array<{ value: Theme; icon: 'sun' | 'moon'; key: 'theme.light' | 'theme.dark' }> = [
  { value: 'light', icon: 'sun', key: 'theme.light' },
  { value: 'dark', icon: 'moon', key: 'theme.dark' },
];

export function ThemeToggle() {
  const { t } = useI18n();
  const [theme, setTheme] = useTheme();
  return (
    <div className="seg" role="radiogroup" aria-label={t('theme.label')}>
      {OPTIONS.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={theme === o.value} className="seg-item" onClick={() => setTheme(o.value)} title={t(o.key)}>
          <Icon name={o.icon} />
          <span>{t(o.key)}</span>
        </button>
      ))}
    </div>
  );
}
