import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { haptic } from '../lib/haptics';
import { c, DISABLED_OPACITY, PRESSED_OPACITY, radius, space, TOUCH } from '../lib/theme';
import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';

type Kind = 'primary' | 'secondary' | 'outline' | 'indigo' | 'danger' | 'dangerOutline' | 'ghost';

export interface ButtonProps {
  label: string;
  /** May return a promise: the button then stays busy until it settles. */
  onPress?: () => unknown;
  kind?: Kind;
  size?: 'md' | 'lg';
  icon?: IconName;
  loading?: boolean;
  /** Shown instead of the label while busy ("Saving…"). */
  loadingLabel?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

const KINDS: Record<Kind, { bg: string; fg: string; border?: string }> = {
  primary: { bg: c.royal, fg: c.white },
  indigo: { bg: c.indigo, fg: c.white },
  secondary: { bg: c.white, fg: c.royal, border: c.royal },
  outline: { bg: c.white, fg: c.ink, border: c.ink },
  danger: { bg: c.danger, fg: c.white },
  dangerOutline: { bg: c.white, fg: c.danger, border: c.danger },
  ghost: { bg: 'transparent', fg: c.royal },
};

/** A second tap this soon after the first, before the screen re-rendered, is a double tap and is ignored. */
const DOUBLE_TAP_MS = 600;

/**
 * Buttons follow UX.md §3: at least 48dp, label always visible, own spinner, busy and disabled
 * until the work finishes. Double taps are dropped inside the handler, not only via `disabled`,
 * because a second tap can arrive before the parent re-renders with `loading`.
 */
export function Button({ label, onPress, kind = 'primary', size = 'md', icon, loading, loadingLabel, disabled, style, testID, accessibilityLabel, accessibilityHint }: ButtonProps) {
  const k = KINDS[kind];
  const [running, setRunning] = useState(false);
  const lastPress = useRef<{ at: number; handler: unknown }>({ at: 0, handler: null });
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const busy = !!loading || running;
  const off = !!disabled || busy;

  function handlePress() {
    const now = Date.now();
    if (off || inFlight.current || !onPress) return;
    // Same handler (the screen has not re-rendered since) and only just pressed: a double tap.
    if (lastPress.current.handler === onPress && now - lastPress.current.at < DOUBLE_TAP_MS) return;
    lastPress.current = { at: now, handler: onPress };
    haptic.tap();
    const result = onPress();
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      inFlight.current = true;
      setRunning(true);
      void (result as Promise<unknown>)
        .catch(() => undefined)
        .finally(() => {
          inFlight.current = false;
          if (mounted.current) setRunning(false);
        });
    }
  }

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: off, busy }}
      onPress={handlePress}
      style={({ pressed }) => [
        styles.base,
        { minHeight: size === 'lg' ? 56 : TOUCH, backgroundColor: k.bg, opacity: disabled && !busy ? DISABLED_OPACITY + 0.1 : pressed && !off ? PRESSED_OPACITY : 1 },
        k.border ? { borderWidth: 1.5, borderColor: k.border } : null,
        style,
      ]}
    >
      <View style={styles.row}>
        {busy ? <ActivityIndicator testID={testID ? `${testID}-spinner` : undefined} color={k.fg} size="small" /> : icon ? <Icon name={icon} size={18} color={k.fg} /> : null}
        <Txt variant="bold" size={size === 'lg' ? 'lg' : 'md'} color={k.fg} numberOfLines={2} align="center" style={styles.label}>
          {busy && loadingLabel ? loadingLabel : label}
        </Txt>
      </View>
    </Pressable>
  );
}

/** A square icon button (back, bell, month arrows): 48dp touch target. */
export function IconButton({
  icon,
  onPress,
  label,
  bg = c.white,
  color = c.ink,
  badge,
  border,
  testID,
  size = TOUCH,
}: {
  icon: IconName;
  onPress?: () => void;
  label: string;
  bg?: string;
  color?: string;
  badge?: number;
  border?: string;
  testID?: string;
  size?: number;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={Math.max(4, (TOUCH - size) / 2)}
      style={({ pressed }) => [styles.icon, { width: size, height: size, backgroundColor: bg, opacity: pressed ? PRESSED_OPACITY : 1 }, border ? { borderWidth: 1.5, borderColor: border } : null]}
    >
      <Icon name={icon} size={size >= TOUCH ? 20 : 18} color={color} />
      {badge ? (
        <View style={styles.badge}>
          <Txt variant="bold" size="xs" color={c.white}>
            {badge > 99 ? '99+' : badge}
          </Txt>
        </View>
      ) : null}
    </Pressable>
  );
}

/** A text link with a 48dp tall touch area. */
export function LinkButton({ label, onPress, color = c.royal, testID }: { label: string; onPress?: () => void; color?: string; testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="link" onPress={onPress} hitSlop={8} style={({ pressed }) => [styles.link, { opacity: pressed ? PRESSED_OPACITY : 1 }]}>
      <Txt variant="bold" size="sm" color={color}>
        {label}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg, paddingVertical: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm },
  label: { flexShrink: 1 },
  icon: { borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
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
  link: { minHeight: TOUCH, justifyContent: 'center' },
});
