// Slim "No internet" banner at the top (UX.md §5). Shown while the API client sees network errors;
// it checks again every few seconds and when the app comes back to the foreground, and refreshes the
// screen's data as soon as the server answers.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { isOnline, useOnline } from '../lib/network';
import { c, space, TOUCH } from '../lib/theme';
import { AppText } from './AppText';
import { Icon } from './Icon';
import { useToast } from './Toast';

/** How often to check while offline. */
export const OFFLINE_RETRY_MS = 5_000;

/** A cheap public request: any answer from the server means we are back online. */
const probe = () => api.categories().then(
  () => undefined,
  () => undefined,
);

export function OfflineBanner() {
  const { t } = useTranslation();
  const online = useOnline();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const toast = useToast();
  const [checking, setChecking] = useState(false);
  const wasOffline = useRef(false);

  // Back online: refetch what is on screen.
  useEffect(() => {
    if (!online) {
      wasOffline.current = true;
      return;
    }
    if (wasOffline.current) {
      wasOffline.current = false;
      void qc.refetchQueries({ type: 'active' });
      toast.info(t('offline.back'));
    }
  }, [online, qc, toast, t]);

  // Auto-retry while offline.
  useEffect(() => {
    if (online) return;
    const timer = setInterval(() => void probe(), OFFLINE_RETRY_MS);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void probe());
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [online]);

  const retry = useCallback(async () => {
    setChecking(true);
    await probe();
    setChecking(false);
    if (!isOnline()) toast.error(t('offline.stillOffline'));
  }, [t, toast]);

  if (online) return null;
  return (
    <View style={[styles.banner, { paddingTop: insets.top }]} accessibilityRole="alert" accessibilityLiveRegion="polite" testID="offline-banner">
      <View style={styles.row}>
        <Icon name="wifiOff" size={18} color={c.warningText} />
        <AppText variant="bold" size="sm" color={c.warningText} style={styles.flex}>
          {t('offline.banner')}
        </AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('offline.retry')}
          accessibilityState={{ busy: checking, disabled: checking }}
          disabled={checking}
          onPress={retry}
          style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
        >
          {checking ? <ActivityIndicator size="small" color={c.warningText} /> : null}
          <AppText variant="bold" size="sm" color={c.warningText}>
            {t('offline.retry')}
          </AppText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  banner: { backgroundColor: c.peach, borderBottomWidth: 1, borderBottomColor: c.warningText },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingLeft: space.lg, paddingRight: space.xs, minHeight: TOUCH },
  retry: { minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.md },
  pressed: { opacity: 0.85 },
});
