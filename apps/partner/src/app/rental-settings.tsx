import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { RentalSettings } from '@eventseva/app-shared';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { intOrNull, inventoryKeys, useRentalSettings } from '../lib/inventory';
import { paiseToRupeesInput, rupeesInputToPaise } from '../lib/money';
import { toast } from '../lib/toast';
import { c, space } from '../lib/theme';
import { Button } from '../components/Button';
import { CashToggle } from '../components/CashToggle';
import { Card, CardHeader } from '../components/Card';
import { Field } from '../components/Field';
import { Screen } from '../components/Screen';
import { Segmented } from '../components/Segmented';
import { QueryView } from '../components/States';
import { Txt } from '../components/Txt';

/** How rentals are booked: delivery charges, minimum order, notice, setup and pickup time, approval. */
export default function RentalSettingsScreen() {
  const settings = useRentalSettings();
  return <QueryView query={settings}>{(s) => <SettingsForm settings={s} />}</QueryView>;
}

const rupeesText = (paise: number | null) => (paise ? paiseToRupeesInput(paise) : '');
const hoursText = (minutes: number) => (minutes ? String(Math.round(minutes / 60)) : '');

function SettingsForm({ settings }: { settings: RentalSettings }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [delivery, setDelivery] = useState(rupeesText(settings.deliveryFeePaise));
  const [freeKm, setFreeKm] = useState(settings.travelFreeKm ? String(settings.travelFreeKm) : '');
  const [perKm, setPerKm] = useState(rupeesText(settings.travelPerKmPaise));
  const [minOrder, setMinOrder] = useState(rupeesText(settings.minOrderPaise));
  const [lead, setLead] = useState(settings.leadTimeHours !== null ? String(settings.leadTimeHours) : '');
  const [setup, setSetup] = useState(hoursText(settings.setupMin));
  const [pickup, setPickup] = useState(hoursText(settings.dismantleMin));
  const [cleaning, setCleaning] = useState(hoursText(settings.bufferAfterMin));
  const [approval, setApproval] = useState(settings.approval);
  const [instructions, setInstructions] = useState(settings.instructions ?? '');
  const [cashAllowed, setCashAllowed] = useState(settings.cashAllowed ?? false);

  const money = [delivery, perKm, minOrder].map((v) => (v.trim() ? rupeesInputToPaise(v) : 0));
  const invalid = money.some((m) => m === null);

  const save = useMutation({
    mutationFn: () => {
      const [deliveryFeePaise, travelPerKmPaise, minOrderPaise] = money as number[];
      const hours = (v: string) => (intOrNull(v) ?? 0) * 60;
      return api.put<RentalSettings>('/v1/partner/rental-settings', {
        deliveryFeePaise,
        travelFreeKm: intOrNull(freeKm) ?? 0,
        travelPerKmPaise,
        minOrderPaise,
        ...(lead ? { leadTimeHours: intOrNull(lead)! } : {}),
        setupMin: hours(setup),
        dismantleMin: hours(pickup),
        bufferAfterMin: hours(cleaning),
        approval,
        instructions: instructions.trim() || undefined,
        cashAllowed,
      });
    },
    onSuccess: (saved) => {
      qc.setQueryData(inventoryKeys.settings, saved);
      toast.success(t('rentalSettings.saved'));
      router.back();
    },
    onError: (e) => toast.error(errorText(t, e)),
  });
  const num = (set: (v: string) => void) => (v: string) => set(v.replace(/\D/g, ''));

  return (
    <Screen
      back
      title={t('rentalSettings.title')}
      footer={<Button testID="save-rental-settings" size="lg" label={t('common.saveChanges')} loadingLabel={t('common.saving')} loading={save.isPending} disabled={invalid} onPress={() => save.mutate()} />}
    >
      <Card style={{ gap: space.md }}>
        <CardHeader title={t('rentalSettings.delivery')} />
        <Field testID="delivery-fee" label={t('rentalSettings.deliveryFee')} hint={t('rentalSettings.deliveryFeeHint')} prefix="₹" value={delivery} onChangeText={setDelivery} keyboardType="decimal-pad" maxLength={9} placeholder="0" />
        <View style={styles.pair}>
          <View style={{ flex: 1 }}><Field testID="free-km" label={t('rentalSettings.freeKm')} value={freeKm} onChangeText={num(setFreeKm)} keyboardType="number-pad" maxLength={3} placeholder="0" /></View>
          <View style={{ flex: 1 }}><Field testID="per-km" label={t('rentalSettings.perKm')} prefix="₹" value={perKm} onChangeText={setPerKm} keyboardType="decimal-pad" maxLength={6} placeholder="0" /></View>
        </View>
        <Field testID="min-order" label={t('rentalSettings.minOrder')} hint={t('rentalSettings.minOrderHint')} prefix="₹" value={minOrder} onChangeText={setMinOrder} keyboardType="decimal-pad" maxLength={9} placeholder="0" />
      </Card>
      <Card style={{ gap: space.md }}>
        <CardHeader title={t('rentalSettings.timing')} />
        <Field testID="lead-hours" label={t('rentalSettings.leadHours')} hint={t('rentalSettings.leadHoursHint')} value={lead} onChangeText={num(setLead)} keyboardType="number-pad" maxLength={3} placeholder="12" />
        <View style={styles.pair}>
          <View style={{ flex: 1 }}><Field testID="setup-hours" label={t('rentalSettings.setupHours')} value={setup} onChangeText={num(setSetup)} keyboardType="number-pad" maxLength={2} placeholder="0" /></View>
          <View style={{ flex: 1 }}><Field testID="pickup-hours" label={t('rentalSettings.pickupHours')} value={pickup} onChangeText={num(setPickup)} keyboardType="number-pad" maxLength={2} placeholder="0" /></View>
        </View>
        <Field testID="cleaning-hours" label={t('rentalSettings.cleaningHours')} hint={t('rentalSettings.cleaningHint')} value={cleaning} onChangeText={num(setCleaning)} keyboardType="number-pad" maxLength={2} placeholder="4" />
      </Card>
      <View style={{ gap: space.sm }}>
        <Txt variant="bold" size="sm">{t('rentalSettings.approval')}</Txt>
        <Segmented options={[{ key: 'vendor', label: t('rentalSettings.approvalVendor') }, { key: 'auto', label: t('rentalSettings.approvalAuto') }]} value={approval} onChange={setApproval} />
        <Txt size="xs" color={c.textMuted}>{t(approval === 'auto' ? 'rentalSettings.approvalAutoNote' : 'rentalSettings.approvalVendorNote')}</Txt>
      </View>
      <Field label={t('rentalSettings.instructions')} value={instructions} onChangeText={setInstructions} multiline maxLength={1000} placeholder={t('rentalSettings.instructionsPlaceholder')} />
      <CashToggle value={cashAllowed} onChange={setCashAllowed} />
      {invalid ? <Txt size="sm" color={c.danger} accessibilityRole="alert">{t('inventory.moneyInvalid')}</Txt> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  pair: { flexDirection: 'row', gap: space.md },
});
