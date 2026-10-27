// First time – name (Role board). Shown once after the first login.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { PARTNER_APP_URL } from '../lib/config';
import { errorText } from '../lib/errors';
import { useSession } from '../lib/session';
import { c, radius, space } from '../lib/theme';
import { AppText } from '../components/AppText';
import { Pill } from '../components/Bits';
import { Button } from '../components/Button';
import { TextField } from '../components/Form';
import { Screen } from '../components/Screen';
import { openLink } from '../lib/links';


export default function WelcomeScreen() {
  const { t } = useTranslation();
  const session = useSession();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const clean = name.trim().replace(/\s+/g, ' ');
    if (clean.length < 2) {
      setError(t('welcome.nameTooShort'));
      return false;
    }
    try {
      // The root layout moves on to Home once the profile has a name.
      session.setMe(await api.updateMe({ name: clean }));
    } catch (e) {
      setError(errorText(t, e));
      throw e;
    }
  }

  return (
    <Screen keyboard scroll contentStyle={styles.content} footer={<Button label={t('welcome.start')} onPress={save} />}>
      <View style={styles.gap8}>
        <Pill label={t('welcome.verified')} tone="mint" />
        <AppText variant="display" size="display" accessibilityRole="header">
          {t('welcome.title')}
        </AppText>
        <AppText size="md">{t('welcome.subtitle')}</AppText>
      </View>
      <TextField
        label={t('welcome.nameLabel')}
        placeholder={t('welcome.namePlaceholder')}
        value={name}
        onChangeText={(v) => {
          setName(v);
          setError(null);
        }}
        autoFocus
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
        maxLength={80}
        error={error}
        returnKeyType="done"
        onSubmitEditing={() => void save().catch(() => undefined)}
      />
      <View style={styles.vendorBox}>
        <AppText variant="bold" size="lg">
          {t('welcome.vendorTitle')}
        </AppText>
        <AppText size="sm">{t('welcome.vendorBody')}</AppText>
        <AppText variant="bold" size="md" color={c.royal} accessibilityRole="link" onPress={() => openLink(PARTNER_APP_URL)} style={styles.link}>
          {t('welcome.vendorLink')}
        </AppText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: space.xxxl + space.sm, gap: space.xxl },
  gap8: { gap: space.sm },
  vendorBox: { borderRadius: 18, backgroundColor: c.lavender, paddingVertical: space.lg, paddingHorizontal: 18, gap: 6 },
  link: { paddingVertical: space.sm, borderRadius: radius.sm },
});
