import { memo, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { haptic } from '../lib/haptics';
import { c, radius, space, TOUCH } from '../lib/theme';
import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

type Variant = 'primary' | 'secondary' | 'outline' | 'dark' | 'danger' | 'dangerOutline' | 'ghost';

/**
 * What a press handler may return. A promise makes the button busy until it settles. It resolving to
 * `false` means "not done" (e.g. the form had errors) and gives the error haptic instead of success;
 * `null` means "nothing happened" (e.g. the payment window was closed) and gives no haptic.
 */
export type PressResult = void | boolean | Promise<unknown>;

export interface ButtonProps {
  label: string;
  onPress: () => PressResult;
  variant?: Variant;
  /** lg = 56dp main actions (boards: 3.5rem), md = 48dp. */
  size?: 'lg' | 'md';
  icon?: IconName;
  /** Busy from outside (e.g. a mutation started elsewhere). */
  loading?: boolean;
  /** Shown next to the spinner while busy, e.g. "Verifying payment…". The label is used otherwise. */
  loadingLabel?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}

const look: Record<Variant, { bg: string; fg: string; border?: string }> = {
  primary: { bg: c.royal, fg: c.white },
  secondary: { bg: c.lavender, fg: c.royal },
  outline: { bg: c.white, fg: c.royal, border: c.royal },
  dark: { bg: c.ink, fg: c.white },
  // UX.md §1: destructive buttons are #b42318 with white text.
  danger: { bg: c.danger, fg: c.white },
  dangerOutline: { bg: c.white, fg: c.danger, border: c.danger },
  ghost: { bg: 'transparent', fg: c.royal },
};

const isPromise = (v: unknown): v is Promise<unknown> => !!v && typeof (v as Promise<unknown>).then === 'function';

/**
 * Runs a press handler at most once at a time. The guard is a ref, so a second tap that arrives
 * before React re-renders the disabled button is still ignored (UX.md §3: never send twice).
 */
export function usePressGuard(onPress: () => PressResult) {
  const running = useRef(false);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const press = () => {
    if (running.current) return;
    const result = onPress();
    if (result === false) return haptic.error();
    if (!isPromise(result)) return;
    running.current = true;
    setBusy(true);
    result
      .then(
        (v) => (v === false ? haptic.error() : v === null ? undefined : haptic.success()),
        () => haptic.error(),
      )
      .finally(() => {
        running.current = false;
        if (mounted.current) setBusy(false);
      });
  };
  return { press, busy };
}

export const Button = memo(function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'lg',
  icon,
  loading,
  loadingLabel,
  disabled,
  style,
  accessibilityHint,
}: ButtonProps) {
  const l = look[variant];
  const guard = usePressGuard(onPress);
  const busy = !!loading || guard.busy;
  const inactive = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy }}
      disabled={inactive}
      onPress={guard.press}
      android_ripple={variant === 'ghost' ? undefined : { color: 'rgba(255,255,255,0.25)' }}
      style={({ pressed }) => [
        styles.base,
        size === 'lg' ? styles.lg : styles.md,
        { backgroundColor: l.bg },
        l.border ? { borderWidth: 1.5, borderColor: l.border } : null,
        disabled ? styles.disabled : pressed ? styles.pressed : null,
        style,
      ]}
    >
      <View style={styles.row}>
        {busy ? <ActivityIndicator color={l.fg} size="small" /> : icon ? <Icon name={icon} color={l.fg} size={20} /> : null}
        <AppText variant="bold" size={size === 'lg' ? 'lg' : 'md'} color={l.fg} numberOfLines={1} style={styles.label}>
          {busy && loadingLabel ? loadingLabel : label}
        </AppText>
      </View>
    </Pressable>
  );
});

/** Square icon button (back, bell, heart, call): 48dp touch target. */
export function IconButton({
  icon,
  label,
  onPress,
  tone = 'white',
  badge,
  iconColor,
  filled,
  loading,
  selected,
}: {
  icon: IconName;
  label: string;
  onPress: () => PressResult;
  tone?: 'white' | 'lavender' | 'outline';
  badge?: number;
  iconColor?: string;
  filled?: boolean;
  loading?: boolean;
  /** For toggles such as the heart. */
  selected?: boolean;
}) {
  const bg = tone === 'lavender' ? c.lavender : c.white;
  const color = iconColor ?? (tone === 'white' ? c.ink : c.royal);
  const guard = usePressGuard(onPress);
  const busy = !!loading || guard.busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy, disabled: busy, ...(selected === undefined ? null : { selected }) }}
      onPress={guard.press}
      disabled={busy}
      hitSlop={4}
      style={({ pressed }) => [styles.iconButton, { backgroundColor: bg }, pressed && styles.pressed, tone === 'outline' && styles.iconOutline]}
    >
      {busy ? <ActivityIndicator color={color} size="small" /> : <Icon name={icon} color={color} fill={filled ? color : 'none'} />}
      {badge ? (
        <View style={styles.badge}>
          <AppText variant="bold" size={11} color={c.white}>
            {badge > 99 ? '99+' : String(badge)}
          </AppText>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg, overflow: 'hidden' },
  lg: { minHeight: 56 },
  md: { minHeight: TOUCH },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.45 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingVertical: space.xs },
  label: { flexShrink: 1 },
  iconButton: { width: TOUCH, height: TOUCH, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  iconOutline: { borderWidth: 1.5, borderColor: c.royal },
  badge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: c.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
