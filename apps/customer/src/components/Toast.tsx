// Snackbar at the bottom of the screen (UX.md §3): "Saved", "Booking request sent", "Removed · Undo".
// One at a time; a new toast replaces the current one. Hides after 3 s, or 5 s when it has an action.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { c, radius, space, TOUCH } from '../lib/theme';
import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastAction {
  label: string;
  onPress: () => void;
}

export interface ToastOptions {
  action?: ToastAction;
  /** ms; default 3000, or 5000 with an action (enough time to reach Undo). */
  duration?: number;
}

interface ToastState extends ToastOptions {
  id: number;
  kind: ToastKind;
  message: string;
}

export interface ToastApi {
  show(kind: ToastKind, message: string, options?: ToastOptions): void;
  success(message: string, options?: ToastOptions): void;
  error(message: string, options?: ToastOptions): void;
  info(message: string, options?: ToastOptions): void;
  hide(): void;
}

export const TOAST_MS = 3000;
export const TOAST_ACTION_MS = 5000;

const noop = () => undefined;
const silent: ToastApi = { show: noop, success: noop, error: noop, info: noop, hide: noop };
const ToastContext = createContext<ToastApi>(silent);

/** Show a toast from anywhere under <ToastProvider>. Outside it, calls do nothing. */
export const useToast = () => useContext(ToastContext);

const LOOK: Record<ToastKind, { bg: string; fg: string; border: string; icon: IconName }> = {
  success: { bg: c.mint, fg: c.successText, border: c.successText, icon: 'checkCircle' },
  error: { bg: c.dangerBg, fg: c.danger, border: c.danger, icon: 'alert' },
  info: { bg: c.lavender, fg: c.royal, border: c.royal, icon: 'bell' },
};

export function ToastProvider({ children, bottomOffset = 88 }: { children: ReactNode; bottomOffset?: number }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const counter = useRef(0);

  const hide = useCallback(() => setToast(null), []);
  const show = useCallback((kind: ToastKind, message: string, options: ToastOptions = {}) => {
    counter.current += 1;
    setToast({ id: counter.current, kind, message, ...options });
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show,
      hide,
      success: (m, o) => show('success', m, o),
      error: (m, o) => show('error', m, o),
      info: (m, o) => show('info', m, o),
    }),
    [show, hide],
  );

  return (
    <ToastContext.Provider value={api}>
      <View style={styles.flex}>
        {children}
        {toast ? <ToastView key={toast.id} toast={toast} onHide={hide} bottomOffset={bottomOffset} /> : null}
      </View>
    </ToastContext.Provider>
  );
}

function ToastView({ toast, onHide, bottomOffset }: { toast: ToastState; onHide: () => void; bottomOffset: number }) {
  const insets = useSafeAreaInsets();
  const anim = useRef(new Animated.Value(0)).current;
  const look = LOOK[toast.kind];

  useEffect(() => {
    Animated.timing(anim, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    // TalkBack reads the live region; VoiceOver needs an explicit announcement.
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(toast.message);
    const ms = toast.duration ?? (toast.action ? TOAST_ACTION_MS : TOAST_MS);
    const timer = setTimeout(onHide, ms);
    return () => clearTimeout(timer);
  }, [anim, onHide, toast]);

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [24, 0] });
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: insets.bottom + bottomOffset }]}>
      <Animated.View
        accessibilityRole="alert"
        accessibilityLiveRegion={toast.kind === 'error' ? 'assertive' : 'polite'}
        testID="toast"
        style={[styles.toast, { backgroundColor: look.bg, borderColor: look.border, opacity: anim, transform: [{ translateY }] }]}
      >
        <Icon name={look.icon} size={20} color={look.fg} />
        <AppText variant="bold" size="md" color={look.fg} style={styles.flex}>
          {toast.message}
        </AppText>
        {toast.action ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={toast.action.label}
            onPress={() => {
              toast.action?.onPress();
              onHide();
            }}
            hitSlop={8}
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          >
            <AppText variant="bold" size="md" color={c.royal}>
              {toast.action.label}
            </AppText>
          </Pressable>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: space.lg },
  toast: {
    width: '100%',
    maxWidth: 560,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingLeft: space.lg,
    paddingRight: space.sm,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: 1.5,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  action: { minHeight: TOUCH, minWidth: TOUCH, paddingHorizontal: space.md, justifyContent: 'center', alignItems: 'center', borderRadius: radius.sm, backgroundColor: c.white },
  pressed: { opacity: 0.85 },
});
