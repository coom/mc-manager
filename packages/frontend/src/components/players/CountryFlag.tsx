import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { flagEmoji, countryName } from '@/lib/country';

/** Drapeau + nom au survol ; « LAN » si une IP est connue sans pays ; rien sans IP. */
export function CountryFlag({ country, hasIp }: { country: string | null | undefined; hasIp: boolean }) {
  const { i18n, t } = useTranslation();
  if (country) return <span title={countryName(country, i18n.language)} aria-label={countryName(country, i18n.language)}>{flagEmoji(country)}</span>;
  if (hasIp) return <Badge variant="secondary" className="text-[10px]">{t('players.lan')}</Badge>;
  return <span className="text-muted-foreground">—</span>;
}
