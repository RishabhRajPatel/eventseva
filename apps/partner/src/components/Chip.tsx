import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { haptic } from '../lib/haptics';
import { c, DISABLED_OPACITY, PRESSED_OPACITY, radius, space } from '../lib/theme';
import { Txt } from './Txt';
import { Icon } from './Icon';

export type Tone = 'success' | 'warning' | 'info' | 'danger' | 'neutral' | 'primary';

/** Status pairs from UX.md §1 (all ≥ 4.5:1). */
export const TONES: Record<Tone, { bg: string; fg: string }> = {
  success: { bg: c.mint, fg: c.onSuccess },
  warning: { bg: c.peach, fg: c.onWarning },
  info: { bg: c.lavender, fg: c.royal },
  danger: { bg: c.dangerBg, fg: c.onDanger },
  neutral: { bg: c.cream, fg: c.ink },
  primary: { bg: c.royal, fg: c.white },
};

/** Small status pill ("Confirmed", "18h left"). */
export function Pill({ label, tone = 'neutral', testID }: { label: string; tone?: Tone; testID?: string }) {
  const t = TONES[tone];
  return (
    <View testID={testID} style={[styles.pill, { backgroundColor: t.bg }]}>
      <Txt variant="bold" size="xs" color={t.fg} numberOfLines={1}>
        {label}
      </Txt>
    </View>
  );
}

/** Look of every selectable thing (UX.md §2): lilac fill + 2dp royal border + ✓ when selected. */
export const selectStyles = StyleSheet.create({
  on: { backgroundColor: c.lilac, borderWidth: 2, borderColor: c.royal },
  off: { backgroundColor: c.white, borderWidth: 1.5, borderColor: c.outline },
});

/** The round ✓ badge shown on selected chips, cards, slots and photos. */
export function Tick({ size = 18, testID }: { size?: number; testID?: string }) {
  return (
    <View testID={testID} style={[styles.tick, { width: size, height: size, borderRadius: size / 2 }]}>
      <Icon name="check" size={size * 0.7} strokeWidth={3} color={c.white} />
    </View>
  );
}

/**
 * Selectable chip (category, unit, quick reason). `multi` makes it a checkbox; otherwise a radio.
 * With `onRemove` it is a removable tag (package items) instead.
 */
export const ChoiceChip = memo(function ChoiceChip({
  label,
  selected,
  onPress,
  disabled,
  disabledHint,
  onRemove,
  multi,
  testID,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  /** Why it can't be picked ("Booked", "Past date"). */
  disabledHint?: string;
  onRemove?: () => void;
  multi?: boolean;
  testID?: string;
}) {
  const removable = !!onRemove;
  const on = !!selected && !removable;
  return (
    <Pressable
      testID={testID}
      accessibilityRole={removable ? 'button' : multi ? 'checkbox' : 'radio'}
      accessibilityState={removable ? { disabled: !!disabled } : { selected: on, checked: on, disabled: !!disabled }}
      accessibilityHint={disabled ? disabledHint : undefined}
      disabled={disabled}
      onPress={
        disabled
          ? undefined
          : () => {
              haptic.select();
              (onRemove ?? onPress)?.();
            }
      }
      style={({ pressed }) => [
        styles.chip,
        removable ? styles.tag : on ? selectStyles.on : selectStyles.off,
        disabled && !on ? { opacity: DISABLED_OPACITY } : pressed ? { opacity: PRESSED_OPACITY } : null,
      ]}
    >
      {on ? <Tick size={18} /> : null}
      <Txt variant={on ? 'bold' : 'body'} size="sm" color={c.ink}>
        {label}
      </Txt>
      {disabled && disabledHint && !on ? (
        <Txt size="xs" color={c.textMuted}>
          · {disabledHint}
        </Txt>
      ) : null}
      {removable ? <Icon name="close" size={14} color={c.royal} /> : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  pill: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  chip: { minHeight: 44, paddingHorizontal: 14, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', gap: 6, marginVertical: 4 },
  tag: { backgroundColor: c.lavender, borderWidth: 1.5, borderColor: c.lavender },
  tick: { backgroundColor: c.royal, alignItems: 'center', justifyContent: 'center' },
});
