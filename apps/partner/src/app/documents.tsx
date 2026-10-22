import { useTranslation } from 'react-i18next';
import { DocumentsCard } from '../components/DocumentsCard';
import { Screen } from '../components/Screen';
import { Txt } from '../components/Txt';

/** Verification documents, reachable from Profile after onboarding. */
export default function DocumentsScreen() {
  const { t } = useTranslation();
  return (
    <Screen back title={t('docs.title')}>
      <Txt size="md">{t('docs.subtitle')}</Txt>
      <DocumentsCard />
    </Screen>
  );
}
