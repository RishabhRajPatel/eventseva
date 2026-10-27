import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../lib/store';
import { hideToast, toastStore, type ToastTone } from '../lib/toast';
import { c, radius, space, TOUCH } from '../lib/theme';
import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';

const ICON: Record<ToastTone, { name: IconName; bg: string; fg: string }> = {
  success: { name: 'check', bg: c.mint, fg: c.onSuccess },
  error: { name: 'alert', bg: c.dangerBg, fg: c.onDanger },
  info: { name: 'clock', bg: c.lavender, fg: c.royal },
};

/** Renders the current toast at the bottom of the screen. Mounted once, in the root layout. */
export function ToastHost({ bottomOffset = 0 }: { bottomOffset?: number }) {
  const t = useStore(toastStore);
  const insets = useSafeAreaInsets();
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!t) return;
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration: 180, useNativeDriver: true }).start();
  }, [t, anim]);

  if (!t) return null;
  const icon = ICON[t.tone ?? 'success'];
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: insets.bottom + space.lg + bottomOffset }]}>
      <Animated.View
        testID={t.testID ?? 'toast'}
        accessibilityRole={t.tone === 'error' ? 'alert' : 'text'}
        accessibilityLiveRegion="polite"
        style={[styles.toast, { opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }]}
      >
        <View style={[styles.icon, { backgroundColor: icon.bg }]}>
          <Icon name={icon.name} size={14} strokeWidth={2.8} color={icon.fg} />
        </View>
        <Txt size="md" color={c.white} style={styles.message}>
          {t.message}
        </Txt>
        {t.action ? (
          <Pressable
            testID="toast-action"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => {
              hideToast(t.id);
              t.action?.onPress();
            }}
            style={({ pressed }) => [styles.action, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Txt variant="bold" size="md" color={c.lilac}>
              {t.action.label}
            </Txt>
          </Pressable>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space.lg, right: space.lg, alignItems: 'center' },
  toast: {
    width: '100%',
    maxWidth: 560,
    minHeight: TOUCH + 4,
    backgroundColor: c.toast,
    borderRadius: radius.md,
    paddingLeft: space.md,
    paddingRight: space.sm,
    paddingVertical: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  icon: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  message: { flex: 1, lineHeight: 21, paddingVertical: space.xs },
  action: { minHeight: TOUCH, minWidth: TOUCH, paddingHorizontal: space.md, alignItems: 'center', justifyContent: 'center' },
});
