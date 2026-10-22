import { forwardRef, type ReactNode } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputInstance, type TextInputProps } from 'react-native';
import { useLanguage } from '../hooks/useLanguage';
import { c, radius, space, text, TOUCH } from '../lib/theme';
import { AppText } from './AppText';

export interface TextFieldProps extends TextInputProps {
  label: string;
  error?: string | null;
  hint?: string;
  /** Shown inside the box before the input, e.g. "+91". */
  prefix?: ReactNode;
  focused?: boolean;
}

export const TextField = forwardRef<TextInputInstance, TextFieldProps>(function TextField(
  { label, error, hint, prefix, multiline, style, focused, ...rest },
  ref,
) {
  const { fonts } = useLanguage();
  return (
    <View style={styles.field}>
      <AppText variant="bold" size={14}>
        {label}
      </AppText>
      <View style={[styles.box, multiline && styles.multiline, (focused || prefix != null) && styles.boxStrong, error ? styles.boxError : null]}>
        {prefix ? <View style={styles.prefix}>{prefix}</View> : null}
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          placeholderTextColor={c.textMuted}
          multiline={multiline}
          style={[styles.input, { fontFamily: fonts.body }, multiline && styles.inputMultiline, style]}
          {...rest}
        />
      </View>
      {error ? (
        <AppText size="sm" color={c.danger} accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : hint ? (
        <AppText size="sm" color={c.textMuted}>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
});

/** Rounded selectable pill (filters, event types, slots). */
export function Chip({
  label,
  selected,
  onPress,
  tone = 'royal',
  disabled,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  tone?: 'royal' | 'ink';
  disabled?: boolean;
}) {
  const activeBg = tone === 'ink' ? c.ink : c.royal;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      style={[styles.chip, selected ? { backgroundColor: activeBg, borderColor: activeBg } : null, disabled && styles.disabled]}
    >
      <AppText variant="bold" size="sm" color={selected ? c.white : c.text} numberOfLines={1}>
        {label}
      </AppText>
    </Pressable>
  );
}

/** Big two-state option tile (slot, payment method, language). */
export function OptionTile({
  label,
  sublabel,
  selected,
  onPress,
  disabled,
  role = 'radio',
}: {
  label: string;
  sublabel?: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  role?: 'radio' | 'button';
}) {
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityState={{ checked: role === 'radio' ? selected : undefined, selected, disabled: !!disabled }}
      accessibilityLabel={sublabel ? `${label}, ${sublabel}` : label}
      onPress={onPress}
      disabled={disabled}
      style={[styles.option, selected && styles.optionOn, disabled && styles.disabled]}
    >
      <AppText variant={selected ? 'bold' : 'body'} size="md" color={selected ? c.royal : c.text} align="center">
        {label}
      </AppText>
      {sublabel ? (
        <AppText size="xs" color={selected ? c.royal : c.textMuted} align="center">
          {sublabel}
        </AppText>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  field: { gap: space.sm },
  box: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: c.lilac,
    backgroundColor: c.white,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  boxStrong: { borderWidth: 2, borderColor: c.royal },
  boxError: { borderColor: c.danger },
  multiline: { alignItems: 'flex-start' },
  prefix: { alignSelf: 'stretch', justifyContent: 'center', paddingHorizontal: space.lg, borderRightWidth: 1, borderRightColor: c.lavender },
  input: { flex: 1, minHeight: 52, paddingHorizontal: space.lg - 2, fontSize: text.lg - 1, color: c.text },
  inputMultiline: { minHeight: 88, paddingVertical: space.md, textAlignVertical: 'top' },
  chip: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: c.lilac,
    backgroundColor: c.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  option: {
    flex: 1,
    minHeight: TOUCH,
    paddingVertical: space.sm,
    paddingHorizontal: space.sm,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: c.lilac,
    backgroundColor: c.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionOn: { borderWidth: 2, borderColor: c.royal, backgroundColor: c.lavender },
  disabled: { opacity: 0.45 },
});
