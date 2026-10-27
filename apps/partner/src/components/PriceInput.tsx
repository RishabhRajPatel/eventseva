import { forwardRef } from 'react';
import type { TextInputInstance } from 'react-native';
import { useTranslation } from 'react-i18next';
import { rupees } from '@eventseva/app-shared';
import { checkPrice } from '../lib/money';
import { Field } from './Field';

/** Price typed in rupees; the parent converts with checkPrice() when saving. */
export const PriceInput = forwardRef<TextInputInstance, { value: string; onChange: (v: string) => void; label: string; showError?: boolean; testID?: string; onBlur?: () => void }>(function PriceInput(
  { value, onChange, label, showError, testID, onBlur },
  ref,
) {
  const { t } = useTranslation();
  const check = checkPrice(value);
  const error = !check.ok && showError ? t(`price.${check.reason}`) : null;
  return (
    <Field
      ref={ref}
      testID={testID}
      label={label}
      prefix="₹"
      value={value}
      onChangeText={(v) => onChange(v.replace(/[^\d.,]/g, ''))}
      onBlur={onBlur}
      keyboardType="decimal-pad"
      placeholder="0"
      error={error}
      hint={check.ok ? t('price.preview', { amount: rupees(check.paise) }) : t('price.hint')}
    />
  );
});
