// Login – phone number (Login board). English only, no language toggle.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { tenDigits } from '../lib/phone';
import { c, radius, space } from '../lib/theme';
import { AppText } from '../components/AppText';
import { Button } from '../components/Button';
import { TextField } from '../components/Form';
import { Screen } from '../components/Screen';

const CHIPS = [
  { key: 'login.chipHall', bg: c.white },
  { key: 'login.chipDj', bg: c.white },
  { key: 'login.chipCook', bg: c.white },
  { key: 'login.chipBand', bg: c.peach },
  { key: 'login.chipCamera', bg: c.mint },
] as const;

export default function LoginScreen() {
  const { i18n } = useTranslation();
  const t = i18n.getFixedT('en');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    const digits = tenDigits(phone);
    if (!digits) return setError(t('login.invalidPhone'));
    setError(null);
    setBusy(true);
    try {
      const res = await api.sendOtp(digits);
      router.push({ pathname: '/otp', params: { phone: digits, resendAfter: String(res.resendAfterSec) } });
    } catch (e) {
      setError(errorText(t, e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      scroll
      keyboard
      contentStyle={styles.content}
      footer={
        <>
          <Button label={t('login.sendOtp')} onPress={send} loading={busy} disabled={phone.replace(/\D/g, '').length < 10} />
          <AppText size="xs" align="center" lang="en">
            {t('login.terms')}
          </AppText>
        </>
      }
    >
      <AppText variant="display" size="display" color={c.royal} lang="en">
        EventSeva
      </AppText>
      <View style={styles.hero}>
        <View style={styles.chips}>
          {CHIPS.map((chip) => (
            <View key={chip.key} style={[styles.chip, { backgroundColor: chip.bg }]}>
              <AppText variant="bold" size="sm" lang="en">
                {t(chip.key)}
              </AppText>
            </View>
          ))}
        </View>
        <AppText variant="bold" size="lg" lang="en">
          {t('login.tagline')}
        </AppText>
      </View>
      <View style={styles.gap8}>
        <AppText variant="display" size="display" accessibilityRole="header" lang="en">
          {t('login.title')}
        </AppText>
        <AppText size="md" lang="en">
          {t('login.subtitle')}
        </AppText>
      </View>
      <TextField
        label={t('login.mobile')}
        placeholder={t('login.placeholder')}
        value={phone}
        onChangeText={(v) => {
          setPhone(v.replace(/[^\d+ ]/g, ''));
          setError(null);
        }}
        keyboardType="phone-pad"
        textContentType="telephoneNumber"
        autoComplete="tel"
        maxLength={15}
        prefix={
          <AppText variant="bold" size="lg" lang="en">
            +91
          </AppText>
        }
        error={error}
        returnKeyType="send"
        onSubmitEditing={send}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: space.xxxl + space.sm, gap: 28 },
  hero: { minHeight: 200, borderRadius: radius.xl, backgroundColor: c.lilac, padding: space.xxl, justifyContent: 'flex-end', gap: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.pill },
  gap8: { gap: space.sm },
});
