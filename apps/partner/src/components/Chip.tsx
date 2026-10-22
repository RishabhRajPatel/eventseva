import { Pressable, StyleSheet, View } from 'react-native';
import { c, radius, space } from '../lib/theme';
import { Txt } from './Txt';
import { Icon } from './Icon';

export type Tone = 'success' | 'warning' | 'info' | 'danger' | 'neutral' | 'primary';

const TONES: Record<Tone, { bg: string; fg: string }> = {
  success: { bg: c.mint, fg: c.ink },
  warning: { bg: c.peach, fg: c.ink },
  info: { bg: c.lavender, fg: c.royal },
  danger: { bg: c.dangerBg, fg: c.danger },
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

/** Selectable chip (category, unit, quick reason). */
export function ChoiceChip({ label, selected, onPress, disabled, onRemove, testID }: { label: string; selected?: boolean; onPress?: () => void; disabled?: boolean; onRemove?: () => void; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole={onRemove ? 'button' : 'radio'}
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      onPress={disabled ? undefined : onRemove ?? onPress}
      style={[styles.chip, selected ? styles.chipOn : styles.chipOff, disabled && !selected ? { opacity: 0.45 } : null]}
    >
      <Txt variant={selected ? 'bold' : 'body'} size="sm" color={selected ? c.white : c.ink}>
        {label}
      </Txt>
      {onRemove ? <Icon name="close" size={14} color={selected ? c.white : c.ink} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  chip: { minHeight: 40, paddingHorizontal: 14, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', gap: space.xs, marginVertical: 4 },
  chipOn: { backgroundColor: c.royal },
  chipOff: { backgroundColor: c.white, borderWidth: 1, borderColor: c.lilac },
});
