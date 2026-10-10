import { useTranslation } from 'react-i18next';
export default function Players() { const { t } = useTranslation(); return <h1 className="text-xl font-semibold">{t('players.title')}</h1>; }
