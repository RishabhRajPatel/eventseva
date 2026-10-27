import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { FieldDef } from '@eventseva/app-shared';
import { fieldLabel, type FieldError, type FieldValues } from '../lib/engine';
import { c, space } from '../lib/theme';
import { useLang } from '../hooks/useLang';
import { ChoiceChip } from './Chip';
import { Field } from './Field';
import { Txt } from './Txt';

/** One field from a category template (or a vehicle / driver form), in the vendor's language. */
export function FieldInput({
  field: f,
  value,
  onChange,
  error,
  testPrefix = 'attr',
}: {
  field: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
  error?: FieldError | null;
  testPrefix?: string;
}) {
  const { t } = useTranslation();
  const lang = useLang();
  const label = fieldLabel(f, lang) + (f.required ? '' : ` ${t('form.optional')}`);
  const message = error === 'required' ? t('engine.fieldRequired') : error === 'invalid' ? fieldHint(t, f) : null;
  const testID = `${testPrefix}-${f.key}`;

  if (f.type === 'text' || f.type === 'number') {
    return (
      <Field
        testID={testID}
        label={label}
        value={value === undefined || value === null ? '' : String(value)}
        onChangeText={(v) => onChange(f.type === 'number' ? v.replace(/[^\d.]/g, '') : v)}
        keyboardType={f.type === 'number' ? 'decimal-pad' : 'default'}
        autoCapitalize={f.key === 'registration' ? 'characters' : 'sentences'}
        maxLength={f.type === 'text' ? (f.maxLength ?? 500) : 9}
        hint={f.type === 'number' ? (fieldHint(t, f) ?? undefined) : undefined}
        error={message}
      />
    );
  }

  const options =
    f.type === 'boolean'
      ? [
          { value: true as unknown, label: t('common.yes') },
          { value: false as unknown, label: t('common.no') },
        ]
      : (f.options ?? []).map((o) => ({
          value: o.value as unknown,
          label: lang === 'hi' ? o.label.hi : o.label.en,
        }));
  const multi = f.type === 'multiselect';
  const selected = (v: unknown) => (multi ? Array.isArray(value) && value.includes(v) : value === v);
  const toggle = (v: unknown) => {
    if (!multi) return onChange(value === v && !f.required ? undefined : v);
    const list = Array.isArray(value) ? value : [];
    onChange(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  };

  return (
    <View style={styles.group} accessibilityRole={multi ? undefined : 'radiogroup'} accessibilityLabel={label}>
      <Txt variant="bold" size="sm">
        {label}
      </Txt>
      <View style={styles.chips}>
        {options.map((o) => (
          <ChoiceChip key={String(o.value)} testID={`${testID}-${String(o.value)}`} label={o.label} multi={multi} selected={selected(o.value)} onPress={() => toggle(o.value)} />
        ))}
      </View>
      {message ? (
        <Txt size="sm" color={c.danger} accessibilityRole="alert">
          {message}
        </Txt>
      ) : null}
    </View>
  );
}

function fieldHint(t: TFunction, f: FieldDef): string | null {
  if (f.type !== 'number') return f.maxLength ? t('engine.maxChars', { n: f.maxLength }) : null;
  if (f.min !== undefined && f.max !== undefined) return t('engine.between', { min: f.min, max: f.max });
  if (f.min !== undefined) return t('engine.atLeast', { n: f.min });
  if (f.max !== undefined) return t('engine.atMost', { n: f.max });
  return null;
}

const styles = StyleSheet.create({
  group: { gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
