import { useState } from 'react';
import { Alert, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { BankAccount } from '@eventseva/app-shared';
import { api } from '../lib/api';
import { cleanDigits, maskAccount, validateBank, type BankForm } from '../lib/bank';
import { errorText } from '../lib/errors';
import { keys, useBankAccount } from '../lib/queries';
import { c, space } from '../lib/theme';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Field } from '../components/Field';
import { Notice } from '../components/Notice';
import { Screen } from '../components/Screen';
import { Txt } from '../components/Txt';

/** Add or change the payout bank account. The full number is never shown again after saving. */
export default function BankScreen() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const current = useBankAccount().data;
  const [form, setForm] = useState<BankForm>({
    holderName: current?.holderName ?? '',
    accountNumber: '',
    confirmAccountNumber: '',
    ifsc: current?.ifsc ?? '',
    upiId: current?.upiId ?? '',
  });
  const [tried, setTried] = useState(false);
  const errors = validateBank(form);
  const set = (k: keyof BankForm) => (v: string) =>
    setForm((f) => ({ ...f, [k]: k === 'accountNumber' || k === 'confirmAccountNumber' ? cleanDigits(v) : k === 'ifsc' ? v.toUpperCase() : v }));
  const err = (k: keyof BankForm) => (tried && errors[k] ? t(`bank.errors.${errors[k]}`) : null);

  const save = useMutation({
    mutationFn: () =>
      api.put<{ account: BankAccount }>('/v1/partner/bank-account', {
        holderName: form.holderName.trim(),
        accountNumber: form.accountNumber,
        ifsc: form.ifsc.trim(),
        upiId: form.upiId.trim() || undefined,
      }),
    onSuccess: (res) => {
      qc.setQueryData(keys.bank, res.account);
      Alert.alert(t('bank.savedTitle'), t('bank.savedBody'));
      router.back();
    },
    onError: (e) => Alert.alert(t('errors.title'), errorText(t, e)),
  });

  return (
    <Screen
      back
      title={t('bank.title')}
      testID="bank"
      footer={
        <Button
          testID="save-bank"
          label={t('common.save')}
          loading={save.isPending}
          onPress={() => {
            setTried(true);
            if (!Object.keys(errors).length) save.mutate();
          }}
        />
      }
    >
      {current ? <Notice icon="bank">{t('bank.replacing', { account: maskAccount(current.accountLast4) })}</Notice> : null}
      <Card style={{ gap: space.lg }}>
        <Field label={t('bank.holderName')} hint={t('bank.holderHint')} value={form.holderName} onChangeText={set('holderName')} error={err('holderName')} autoCapitalize="words" testID="holder" />
        <Field label={t('bank.accountNumber')} value={form.accountNumber} onChangeText={set('accountNumber')} error={err('accountNumber')} keyboardType="number-pad" maxLength={18} secureTextEntry testID="account" />
        <Field label={t('bank.confirmAccount')} value={form.confirmAccountNumber} onChangeText={set('confirmAccountNumber')} error={err('confirmAccountNumber')} keyboardType="number-pad" maxLength={18} testID="confirm-account" />
        <Field label={t('bank.ifsc')} hint={t('bank.ifscHint')} value={form.ifsc} onChangeText={set('ifsc')} error={err('ifsc')} autoCapitalize="characters" maxLength={11} testID="ifsc" />
        <Field label={t('bank.upi')} value={form.upiId} onChangeText={set('upiId')} error={err('upiId')} autoCapitalize="none" keyboardType="email-address" testID="upi" />
      </Card>
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
