// Login – OTP (Otp board). English only. 30 s resend timer, attempts left, lock message.
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputInstance } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@eventseva/app-shared';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { maskedPhone } from '../lib/phone';
import { useSession } from '../lib/session';
import { c, fonts, radius, space } from '../lib/theme';
import { AppText } from '../components/AppText';
import { Button, IconButton } from '../components/Button';
import { Notice } from '../components/Bits';
import { Screen } from '../components/Screen';

const LENGTH = 6;
const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

export default function OtpScreen() {
  const { i18n } = useTranslation();
  const t = i18n.getFixedT('en');
  const { phone = '', resendAfter } = useLocalSearchParams<{ phone: string; resendAfter?: string }>();
  const session = useSession();
  const input = useRef<TextInputInstance>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(() => Number(resendAfter) || 30);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  async function verify(value = code) {
    if (value.length !== LENGTH || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.verifyOtp(phone, value);
      // The root layout now shows the name screen (new user) or the app.
      await session.signIn(result);
    } catch (e) {
      setCode('');
      if (e instanceof ApiError && e.code === 'OTP_LOCKED') setLocked(true);
      setError(errorText(t, e));
      setBusy(false);
      input.current?.focus();
    }
  }

  async function resend() {
    setError(null);
    try {
      const res = await api.sendOtp(phone);
      setWait(res.resendAfterSec);
      setLocked(false);
      setCode('');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'OTP_TOO_SOON' && typeof e.details.retryAfterSec === 'number') setWait(e.details.retryAfterSec);
      if (e instanceof ApiError && e.code === 'OTP_LOCKED') setLocked(true);
      setError(errorText(t, e));
    }
  }

  const back = () => (router.canGoBack() ? router.back() : router.replace('/login'));

  return (
    <Screen
      keyboard
      contentStyle={styles.content}
      footer={<Button label={t('otp.verify')} onPress={() => verify()} loading={busy} disabled={code.length !== LENGTH || locked} />}
    >
      <IconButton icon="back" label={t('common.back')} onPress={back} />
      <View style={styles.gap8}>
        <AppText variant="display" size="display" accessibilityRole="header" lang="en">
          {t('otp.title')}
        </AppText>
        <AppText size="md" lang="en">
          {t('otp.sentTo', { phone: maskedPhone(phone) })}{' '}
          <AppText variant="bold" size="md" color={c.royal} lang="en" onPress={back} accessibilityRole="link">
            {t('otp.change')}
          </AppText>
        </AppText>
      </View>

      <Pressable onPress={() => input.current?.focus()} style={styles.boxes} accessible={false}>
        {Array.from({ length: LENGTH }, (_, i) => {
          const active = i === Math.min(code.length, LENGTH - 1) && !locked;
          return (
            <View key={i} style={[styles.box, active && styles.boxActive, error && !code ? styles.boxError : null]}>
              <AppText variant="bold" size={22} lang="en">
                {code[i] ?? ''}
              </AppText>
            </View>
          );
        })}
        <TextInput
          ref={input}
          value={code}
          onChangeText={(v) => {
            const digits = v.replace(/\D/g, '').slice(0, LENGTH);
            setCode(digits);
            if (digits.length === LENGTH) void verify(digits);
          }}
          editable={!locked && !busy}
          autoFocus
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          maxLength={LENGTH}
          accessibilityLabel={t('otp.inputLabel')}
          caretHidden
          style={[StyleSheet.absoluteFill, styles.hiddenInput, { fontFamily: fonts.en.body }]}
        />
      </Pressable>

      {error ? (
        <Notice icon="alert" tone="danger">
          <AppText size="sm" lang="en" accessibilityLiveRegion="assertive">
            {error}
          </AppText>
        </Notice>
      ) : null}

      <View style={styles.resend}>
        <AppText size={14} lang="en">
          {t('otp.noCode')}
        </AppText>
        {wait > 0 ? (
          <AppText variant="bold" size={14} lang="en" accessibilityLiveRegion="polite">
            {t('otp.resendIn', { time: mmss(wait) })}
          </AppText>
        ) : (
          <Pressable accessibilityRole="button" onPress={resend} style={styles.resendButton}>
            <AppText variant="bold" size={14} color={c.royal} lang="en">
              {t('otp.resend')}
            </AppText>
          </Pressable>
        )}
      </View>

      <Notice icon="chatCheck" tone="mintLight">
        <AppText size={14} lang="en">
          {t('otp.autofill')}
        </AppText>
      </Notice>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: space.xxxl, gap: 28 },
  gap8: { gap: space.sm },
  boxes: { flexDirection: 'row', gap: space.sm },
  box: {
    flex: 1,
    height: 56,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: c.lilac,
    backgroundColor: c.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxActive: { borderWidth: 2, borderColor: c.royal, backgroundColor: c.lavender },
  boxError: { borderColor: c.danger },
  hiddenInput: { opacity: 0.02, color: 'transparent' },
  resend: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  resendButton: { minHeight: 48, justifyContent: 'center' },
});
