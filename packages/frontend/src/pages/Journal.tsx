import { useTranslation } from 'react-i18next';
export default function Journal() { const { t } = useTranslation(); return <h1 className="text-xl font-semibold">{t('journal.title')}</h1>; }
