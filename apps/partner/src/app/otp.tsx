import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputInstance } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Device from 'expo-device';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../lib/api';
import { errorCode, errorText } from '../lib/errors';
import { maskPhone } from '../lib/phone';
import { useSession } from '../lib/session';
import { englishT as t } from '../i18n';
import { c, radius, space, text } from '../lib/theme';
import { Button, IconButton, LinkButton } from '../components/Button';
import { Icon } from '../components/Icon';
import { FontLanguage, Txt } from '../components/Txt';

const CODE_LENGTH = 6;

/** OTP entry (PartnerOtp board): six boxes over one input so SMS auto-fill works. */
export default function Otp() {
  const insets = useSafeAreaInsets();
  const { signIn } = useSession();
  const params = useLocalSearchParams<{ phone: string; resendAfter?: string }>();
  const phone = params.phone ?? '';
  const input = useRef<TextInputInstance>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(Number(params.resendAfter) || 30);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const id = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [secondsLeft]);

  async function verify(value = code) {
    if (value.length !== CODE_LENGTH || verifying || locked) return;
    setVerifying(true);
    setError(null);
    try {
      const result = await api.verifyOtp(phone, value, 'partner', Device.modelName ?? undefined);
      await signIn(result);
    } catch (e) {
      setError(errorText(t, e));
      if (errorCode(e) === 'OTP_LOCKED' || errorCode(e) === 'USER_BLOCKED') setLocked(true);
      setCode('');
      input.current?.focus();
    } finally {
      setVerifying(false);
    }
  }

  async function resend() {
    setError(null);
    try {
      const res = await api.sendOtp(phone);
      setLocked(false);
      setSecondsLeft(res.resendAfterSec);
    } catch (e) {
      setError(errorText(t, e));
      if (errorCode(e) === 'OTP_LOCKED') setLocked(true);
    }
  }

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
  const ss = String(secondsLeft % 60).padStart(2, '0');

  return (
    <FontLanguage lang="en">
      <View style={[styles.page, { paddingTop: insets.top + space.xxl, paddingBottom: insets.bottom + space.xxl }]}>
        <IconButton icon="back" label={t('common.back')} onPress={() => router.back()} />
        <View style={{ gap: space.sm }}>
          <Txt variant="display" size="display" accessibilityRole="header">
            {t('otp.title')}
          </Txt>
          <Txt size="md" style={{ lineHeight: 22 }}>
            {t('otp.sentTo', { phone: maskPhone(phone) })}
          </Txt>
          <LinkButton label={t('otp.changeNumber')} onPress={() => router.back()} />
        </View>

        <Pressable onPress={() => input.current?.focus()} style={styles.boxes} accessibilityLabel={t('otp.codeLabel')}>
          {Array.from({ length: CODE_LENGTH }, (_, i) => {
            const active = i === Math.min(code.length, CODE_LENGTH - 1);
            return (
              <View key={i} style={[styles.box, active ? styles.boxActive : null, error ? { borderColor: c.danger } : null]}>
                <Txt variant="bold" size="xxl">
                  {code[i] ?? ''}
                </Txt>
              </View>
            );
          })}
          <TextInput
            ref={input}
            testID="otp-input"
            value={code}
            onChangeText={(v) => {
              const digits = v.replace(/\D/g, '').slice(0, CODE_LENGTH);
              setCode(digits);
              setError(null);
              if (digits.length === CODE_LENGTH) void verify(digits);
            }}
            keyboardType="number-pad"
            autoComplete="sms-otp"
            textContentType="oneTimeCode"
            maxLength={CODE_LENGTH}
            autoFocus
            caretHidden
            style={styles.hiddenInput}
          />
        </Pressable>

        {error ? (
          <Txt testID="otp-error" size="sm" color={c.danger} accessibilityRole="alert">
            {error}
          </Txt>
        ) : null}

        <View style={styles.resend}>
          <Txt size="sm">{t('otp.noCode')}</Txt>
          {secondsLeft > 0 ? (
            <Txt variant="bold" size="sm" testID="resend-timer">
              {t('otp.resendIn', { time: `${mm}:${ss}` })}
            </Txt>
          ) : (
            <LinkButton testID="resend" label={t('otp.resend')} onPress={() => void resend()} />
          )}
        </View>

        <View style={styles.autofill}>
          <Icon name="chat" size={20} />
          <Txt size="sm" style={{ flex: 1 }}>
            {t('otp.autofill')}
          </Txt>
        </View>

        <View style={{ flex: 1 }} />
        <Button testID="verify" size="lg" label={t('otp.verify')} loading={verifying} disabled={code.length !== CODE_LENGTH || locked} onPress={() => void verify()} />
      </View>
    </FontLanguage>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: c.cream, paddingHorizontal: space.xxl, gap: space.xxl, width: '100%', maxWidth: 520, alignSelf: 'center' },
  boxes: { flexDirection: 'row', gap: space.sm },
  box: { flex: 1, height: 56, borderRadius: radius.md, borderWidth: 1.5, borderColor: c.lilac, backgroundColor: c.white, alignItems: 'center', justifyContent: 'center' },
  boxActive: { borderWidth: 2, borderColor: c.royal, backgroundColor: c.lavender },
  hiddenInput: { position: 'absolute', opacity: 0, width: '100%', height: '100%', fontSize: text.md },
  resend: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  autofill: { flexDirection: 'row', gap: space.sm, alignItems: 'center', backgroundColor: c.mintLight, borderRadius: radius.md + 2, padding: space.md, paddingHorizontal: space.lg },
});
