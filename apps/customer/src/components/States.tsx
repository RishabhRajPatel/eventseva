// Loading, empty, offline and error states (Empty.dc.html, Offline.dc.html).
import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@eventseva/app-shared';
import { errorText } from '../lib/errors';
import { c, space } from '../lib/theme';
import { AppText } from './AppText';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';

export const isOffline = (e: unknown) => e instanceof ApiError && e.code === 'NETWORK';

export function Loading({ label }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <View style={styles.center} accessibilityRole="progressbar" accessibilityLabel={label ?? t('common.loading')}>
      <ActivityIndicator size="large" color={c.royal} />
    </View>
  );
}

/**
 * Icon, one sentence and one action (UX.md §5). `compact` is for a section inside a page (no
 * reviews yet, nothing in this filter); the full size fills an empty screen.
 */
export function EmptyState({
  icon = 'searchEmpty',
  title,
  body,
  actions,
  tone = 'lavender',
  compact,
}: {
  icon?: IconName;
  title: string;
  body?: string;
  actions?: ReactNode;
  tone?: 'lavender' | 'peach';
  compact?: boolean;
}) {
  if (compact) {
    return (
      <View style={styles.compact}>
        <View style={[styles.smallCircle, tone === 'peach' ? styles.peach : styles.lavender]}>
          <Icon name={icon} size={28} strokeWidth={1.6} color={tone === 'peach' ? c.warningText : c.royal} />
        </View>
        <AppText variant="bold" size="md" align="center">
          {title}
        </AppText>
        {body ? (
          <AppText size="sm" align="center" style={styles.body}>
            {body}
          </AppText>
        ) : null}
        {actions ? <View style={styles.actions}>{actions}</View> : null}
      </View>
    );
  }
  return (
    <View style={styles.center}>
      <View style={[styles.circle, tone === 'peach' ? styles.peach : styles.lavender]}>
        <Icon name={icon} size={56} strokeWidth={1.5} color={tone === 'peach' ? c.warningText : c.royal} />
      </View>
      <AppText variant="display" size="xxl" align="center" accessibilityRole="header">
        {title}
      </AppText>
      {body ? (
        <AppText size="md" align="center" style={styles.body}>
          {body}
        </AppText>
      ) : null}
      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </View>
  );
}

export function OfflineState({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon="wifiOff"
      tone="peach"
      title={t('offline.title')}
      body={t('offline.body')}
      actions={
        <>
          <Button label={t('offline.retry')} onPress={onRetry} />
          <Button label={t('offline.bookings')} variant="outline" onPress={() => router.navigate('/bookings')} />
        </>
      }
    />
  );
}

/** Offline board for network errors; otherwise the translated message with a retry. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useTranslation();
  if (isOffline(error)) return <OfflineState onRetry={onRetry} />;
  return (
    <EmptyState
      icon="alert"
      title={t('common.errorTitle')}
      body={errorText(t, error)}
      actions={<Button label={t('offline.retry')} onPress={onRetry} />}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg, paddingHorizontal: space.xxl, paddingVertical: space.xxxl },
  circle: { width: 112, height: 112, borderRadius: 56, alignItems: 'center', justifyContent: 'center' },
  smallCircle: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  lavender: { backgroundColor: c.lavender },
  peach: { backgroundColor: c.peach },
  compact: { alignItems: 'center', gap: space.sm, paddingVertical: space.xl, paddingHorizontal: space.lg, backgroundColor: c.white, borderRadius: 16 },
  body: { maxWidth: 300 },
  actions: { width: '100%', maxWidth: 300, gap: space.sm, marginTop: space.sm },
});
