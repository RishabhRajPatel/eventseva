import { forwardRef, memo, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View, type TextInputInstance, type TextInputProps } from 'react-native';
import { useLanguage } from '../hooks/useLanguage';
import { haptic } from '../lib/haptics';
import { c, radius, space, text, TOUCH } from '../lib/theme';
import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

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
      <AppText variant="bold" size="sm">
        {label}
      </AppText>
      <View style={[styles.box, multiline && styles.multiline, (focused || prefix != null) && styles.boxStrong, error ? styles.boxError : null]}>
        {prefix ? <View style={styles.prefix}>{prefix}</View> : null}
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          accessibilityHint={error ?? hint}
          placeholderTextColor={c.textMuted}
          multiline={multiline}
          style={[styles.input, { fontFamily: fonts.body }, multiline && styles.inputMultiline, style]}
          {...rest}
        />
      </View>
      {error ? (
        <View style={styles.errorRow}>
          <Icon name="alert" size={16} color={c.danger} />
          <AppText size="sm" color={c.danger} accessibilityLiveRegion="polite" style={styles.flex}>
            {error}
          </AppText>
        </View>
      ) : hint ? (
        <AppText size="sm" color={c.textMuted}>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
});

/** The small royal ✓ badge on selected things (never colour alone, UX.md §2). */
export function SelectedMark({ size = 20 }: { size?: number }) {
  return (
    <View testID="selected-mark" style={[styles.mark, { width: size, height: size, borderRadius: size / 2 }]}>
      <Icon name="check" size={Math.round(size * 0.65)} color={c.white} strokeWidth={3} />
    </View>
  );
}

/** Inline error under a group of choices (slots, event picker). */
export function FieldError({ children }: { children: string | null | undefined }) {
  if (!children) return null;
  return (
    <View style={styles.errorRow}>
      <Icon name="alert" size={16} color={c.danger} />
      <AppText size="sm" color={c.danger} accessibilityLiveRegion="polite" style={styles.flex}>
        {children}
      </AppText>
    </View>
  );
}

type SelectRole = 'radio' | 'checkbox' | 'button';

/** Selected / disabled accessibility state for anything choosable. */
const selectState = (role: SelectRole, selected: boolean, disabled?: boolean, busy?: boolean) => ({
  selected,
  ...(role === 'button' ? null : { checked: selected }),
  disabled: !!disabled,
  ...(busy ? { busy: true } : null),
});

/**
 * Rounded selectable pill (filters, event types, categories). `radio` for one-of, `checkbox` for
 * on/off filters, `button` for chips that open a picker (still shown selected when a value is set).
 */
export const Chip = memo(function Chip({
  label,
  selected = false,
  onPress,
  disabled,
  role = 'radio',
  busy,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  role?: SelectRole;
  busy?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityState={selectState(role, selected, disabled, busy)}
      accessibilityLabel={label}
      onPress={() => {
        haptic.select();
        onPress?.();
      }}
      disabled={disabled}
      style={({ pressed }) => [styles.chip, selected && styles.on, pressed && styles.pressed, disabled && styles.disabled]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={c.royal} />
      ) : selected ? (
        <View testID="selected-mark">
          <Icon name="check" size={16} color={c.royal} strokeWidth={3} />
        </View>
      ) : null}
      <AppText variant="bold" size="sm" color={selected ? c.royal : c.text} numberOfLines={1}>
        {label}
      </AppText>
    </Pressable>
  );
});

/** Big two-state option tile (slot, payment method). Disabled tiles say why in the sublabel. */
export const OptionTile = memo(function OptionTile({
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
  role?: 'radio' | 'checkbox';
}) {
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityState={selectState(role, selected, disabled)}
      accessibilityLabel={sublabel ? `${label}, ${sublabel}` : label}
      onPress={() => {
        haptic.select();
        onPress();
      }}
      disabled={disabled}
      style={({ pressed }) => [styles.option, selected && styles.on, pressed && styles.pressed, disabled && styles.disabled]}
    >
      {selected ? (
        <View style={styles.cornerMark}>
          <SelectedMark size={18} />
        </View>
      ) : null}
      <AppText variant={selected ? 'bold' : 'body'} size="md" color={selected ? c.royal : c.text} align="center">
        {label}
      </AppText>
      {sublabel ? (
        <AppText size="xs" color={selected ? c.ink : c.textMuted} align="center">
          {sublabel}
        </AppText>
      ) : null}
    </Pressable>
  );
});

/** Full-width choice row (what to book, which event): radio circle or ✓, label, optional right text. */
export const ChoiceRow = memo(function ChoiceRow({
  label,
  selected,
  onPress,
  icon,
  right,
  accessibilityLabel,
  disabled,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  icon?: IconName;
  right?: string;
  accessibilityLabel?: string;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={selectState('radio', selected, disabled)}
      accessibilityLabel={accessibilityLabel ?? (right ? `${label}, ${right}` : label)}
      onPress={() => {
        haptic.select();
        onPress();
      }}
      disabled={disabled}
      style={({ pressed }) => [styles.choice, selected && styles.on, pressed && styles.pressed, disabled && styles.disabled]}
    >
      {selected ? <SelectedMark /> : <View style={styles.radio} />}
      {icon ? <Icon name={icon} size={18} color={c.royal} /> : null}
      <AppText variant={selected ? 'bold' : 'body'} size="md" style={styles.flex}>
        {label}
      </AppText>
      {right ? (
        <AppText variant="bold" size="sm" color={c.royal}>
          {right}
        </AppText>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  field: { gap: space.sm },
  box: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: c.outline,
    backgroundColor: c.white,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  boxStrong: { borderWidth: 2, borderColor: c.royal },
  boxError: { borderWidth: 2, borderColor: c.danger },
  multiline: { alignItems: 'flex-start' },
  prefix: { alignSelf: 'stretch', justifyContent: 'center', paddingHorizontal: space.lg, borderRightWidth: 1, borderRightColor: c.lavender },
  input: { flex: 1, minHeight: 52, paddingHorizontal: space.lg - 2, fontSize: text.lg - 1, color: c.text },
  inputMultiline: { minHeight: 88, paddingVertical: space.md, textAlignVertical: 'top' },
  errorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.xs },
  mark: { backgroundColor: c.selectedBorder, alignItems: 'center', justifyContent: 'center' },
  // Unselected: white with a 1.5dp outline border (3:1); selected: lilac fill, 2dp royal border, ✓ (UX.md §2).
  chip: {
    minHeight: TOUCH,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: c.outline,
    backgroundColor: c.white,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
  },
  on: { borderWidth: 2, borderColor: c.selectedBorder, backgroundColor: c.selectedBg },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.4 },
  option: {
    flex: 1,
    minHeight: 64,
    paddingVertical: space.sm,
    paddingHorizontal: space.sm,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: c.outline,
    backgroundColor: c.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cornerMark: { position: 'absolute', top: 4, right: 4 },
  choice: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: c.outline,
    backgroundColor: c.white,
    paddingHorizontal: 14,
    paddingVertical: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: c.outline },
});
