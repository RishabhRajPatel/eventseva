import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { BankAccount } from '@eventseva/app-shared';
import { api } from '../lib/api';
import { cleanDigits, maskAccount, validateBank, type BankForm } from '../lib/bank';
import { errorText } from '../lib/errors';
import { keys, useBankAccount } from '../lib/queries';
import { toast } from '../lib/toast';
import { c, space, TOUCH } from '../lib/theme';
import { useForm } from '../hooks/useForm';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { Notice } from '../components/Notice';
import { Screen } from '../components/Screen';
import { Txt } from '../components/Txt';

const FIELDS = ['holderName', 'accountNumber', 'confirmAccountNumber', 'ifsc', 'upiId'] as const;

/** Add or change the payout bank account. The number is hidden while typing and never shown again after saving. */
export default function BankScreen() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const current = useBankAccount().data;
  const form = useForm(FIELDS);
  const [values, setValues] = useState<BankForm>({
    holderName: current?.holderName ?? '',
    accountNumber: '',
    confirmAccountNumber: '',
    ifsc: current?.ifsc ?? '',
    upiId: current?.upiId ?? '',
  });
  const [showNumber, setShowNumber] = useState(false);
  const errors = validateBank(values);
  const set = (k: keyof BankForm) => (v: string) =>
    setValues((f) => ({ ...f, [k]: k === 'accountNumber' || k === 'confirmAccountNumber' ? cleanDigits(v) : k === 'ifsc' ? v.toUpperCase() : v }));
  const err = (k: keyof BankForm) => (form.show(k) && errors[k] ? t(`bank.errors.${errors[k]}`) : null);
  const last4 = values.accountNumber.length >= 4 ? values.accountNumber.slice(-4) : null;
  const matches = !!values.confirmAccountNumber && values.confirmAccountNumber === values.accountNumber && !errors.accountNumber;

  const save = useMutation({
    mutationFn: () =>
      api.put<{ account: BankAccount }>('/v1/partner/bank-account', {
        holderName: values.holderName.trim(),
        accountNumber: values.accountNumber,
        ifsc: values.ifsc.trim(),
        upiId: values.upiId.trim() || undefined,
      }),
    onSuccess: (res) => {
      qc.setQueryData(keys.bank, res.account);
      toast.success(t('bank.savedToast', { account: maskAccount(res.account.accountLast4) }));
      router.back();
    },
    onError: (e) => toast.error(errorText(t, e)),
  });

  const field = (k: keyof BankForm) => ({ ref: form.ref(k), onBlur: form.blur(k), error: err(k), onChangeText: set(k), value: values[k], testID: TEST_IDS[k] });

  return (
    <Screen
      back
      title={t('bank.title')}
      testID="bank"
      scrollRef={form.scrollRef}
      footer={
        <Button
          testID="save-bank"
          size="lg"
          label={t('bank.save')}
          loadingLabel={t('common.saving')}
          loading={save.isPending}
          onPress={() => {
            if (!save.isPending && form.check(errors)) save.mutate();
          }}
        />
      }
    >
      {current ? <Notice icon="bank">{t('bank.replacing', { account: maskAccount(current.accountLast4) })}</Notice> : null}
      {/* Fields sit directly in the scroll content so a failed Save can scroll to the first wrong one. */}
      <View {...form.at('holderName')}>
          <Field label={t('bank.holderName')} hint={t('bank.holderHint')} autoCapitalize="words" autoComplete="name" {...field('holderName')} />
        </View>
        <View {...form.at('accountNumber')}>
          <Field
            label={t('bank.accountNumber')}
            keyboardType="number-pad"
            maxLength={18}
            secureTextEntry={!showNumber}
            autoComplete="off"
            hint={last4 && !err('accountNumber') ? t('bank.endsWith', { last4 }) : t('bank.accountHint')}
            right={
              <Pressable testID="toggle-account" accessibilityRole="button" onPress={() => setShowNumber((v) => !v)} hitSlop={4} style={styles.toggle}>
                <Txt variant="bold" size="sm" color={c.royal}>
                  {showNumber ? t('bank.hide') : t('bank.show')}
                </Txt>
              </Pressable>
            }
            {...field('accountNumber')}
          />
        </View>
        <View {...form.at('confirmAccountNumber')}>
          <Field
            label={t('bank.confirmAccount')}
            keyboardType="number-pad"
            maxLength={18}
            secureTextEntry={!showNumber}
            autoComplete="off"
            hint={matches ? t('bank.matches') : undefined}
            {...field('confirmAccountNumber')}
          />
        </View>
        <View {...form.at('ifsc')}>
          <Field label={t('bank.ifsc')} hint={t('bank.ifscHint')} autoCapitalize="characters" maxLength={11} {...field('ifsc')} />
        </View>
        <View {...form.at('upiId')}>
          <Field label={t('bank.upi')} autoCapitalize="none" keyboardType="email-address" {...field('upiId')} />
        </View>
      <View style={{ gap: space.xs }}>
        <Txt size="sm" color={c.textMuted}>
          {t('bank.note')}
        </Txt>
        <Txt size="sm" color={c.textMuted}>
          {t('bank.security')}
        </Txt>
      </View>
    </Screen>
  );
}

const TEST_IDS: Record<keyof BankForm, string> = { holderName: 'holder', accountNumber: 'account', confirmAccountNumber: 'confirm-account', ifsc: 'ifsc', upiId: 'upi' };

const styles = StyleSheet.create({
  toggle: { minHeight: TOUCH, minWidth: TOUCH, paddingHorizontal: space.md, alignItems: 'center', justifyContent: 'center' },
});
