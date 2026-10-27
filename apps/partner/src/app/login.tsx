import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '@eventseva/app-shared';
import { api } from '../lib/api';
import { isValidMobile } from '../lib/phone';
import { errorCode, errorText } from '../lib/errors';
import { englishT as t } from '../i18n';
import { c, radius, space } from '../lib/theme';
import { Button, LinkButton } from '../components/Button';
import { Field } from '../components/Field';
import { Icon } from '../components/Icon';
import { FontLanguage, Txt } from '../components/Txt';
import { openLink } from '../lib/links';


/** Phone login (PartnerLogin board). Always English; Hindi is chosen later in Profile. */
export default function Login() {
  const insets = useSafeAreaInsets();
  const [digits, setDigits] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function send() {
    if (!isValidMobile(digits)) {
      setError(t('login.invalidPhone'));
      return;
    }
    setError(null);
    setSending(true);
    const phone = `+91${digits}`;
    try {
      const res = await api.sendOtp(phone);
      router.push({ pathname: '/otp', params: { phone, resendAfter: String(res.resendAfterSec) } });
    } catch (e) {
      // A code was sent moments ago: it is still valid, so go and type it.
      if (errorCode(e) === 'OTP_TOO_SOON' && e instanceof ApiError) {
        router.push({ pathname: '/otp', params: { phone, resendAfter: String(e.details.retryAfterSec ?? 30) } });
      } else {
        setError(errorText(t, e));
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <FontLanguage lang="en">
      <StatusBar style="light" />
      <ScrollView style={{ backgroundColor: c.indigo }} contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        <View style={[styles.top, { paddingTop: insets.top + space.xxxl }]}>
          <View style={styles.brand}>
            <Txt variant="display" size="display" color={c.white}>
              {t('login.brand')}
            </Txt>
            <View style={styles.partner}>
              <Txt variant="bold" size="xs">
                {t('login.partnerBadge')}
              </Txt>
            </View>
          </View>
          <Txt variant="display" size="display" color={c.white} style={{ lineHeight: 35 }} accessibilityRole="header">
            {t('login.headline')}
          </Txt>
          <View style={{ gap: space.md }}>
            {(['benefitRequests', 'benefitAdvance', 'benefitPayout'] as const).map((k) => (
              <View key={k} style={styles.benefit}>
                <View style={styles.tick}>
                  <Icon name="check" size={16} strokeWidth={2.5} />
                </View>
                <Txt size="md" color={c.white} style={{ flex: 1 }}>
                  {t(`login.${k}`)}
                </Txt>
              </View>
            ))}
          </View>
        </View>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space.xxl }]}>
          <View style={{ gap: 6 }}>
            <Txt variant="display" size="xxl">
              {t('login.title')}
            </Txt>
            <Txt size="sm">{t('login.subtitle')}</Txt>
          </View>
          <Field
            testID="phone-input"
            label={t('login.mobile')}
            prefix="+91"
            value={digits}
            onChangeText={(v) => {
              setDigits(v.replace(/\D/g, '').slice(-10));
              setError(null);
            }}
            keyboardType="number-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            maxLength={10}
            placeholder={t('login.placeholder')}
            error={error}
            onSubmitEditing={() => void send()}
          />
          <View style={{ flexGrow: 1, minHeight: space.xl }} />
          <Button testID="send-otp" kind="indigo" size="lg" label={t('login.sendOtp')} loading={sending} onPress={() => void send()} />
          <View style={styles.footer}>
            <Txt size="sm">{t('login.customerQuestion')}</Txt>
            <LinkButton label={t('login.customerLink')} onPress={() => void openLink('https://play.google.com/store/apps/details?id=in.eventseva.app')} />
          </View>
        </View>
      </ScrollView>
    </FontLanguage>
  );
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: space.xxl, paddingBottom: space.xxl + 4, gap: space.xl },
  brand: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  partner: { backgroundColor: c.peach, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  benefit: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  tick: { width: 32, height: 32, borderRadius: 16, backgroundColor: c.mint, alignItems: 'center', justifyContent: 'center' },
  sheet: { flexGrow: 1, backgroundColor: c.cream, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: space.xxl, paddingTop: space.xxl + 4, gap: space.xl },
  footer: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', columnGap: space.xs },
});
