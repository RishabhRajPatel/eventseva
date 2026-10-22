import { ActivityIndicator, StyleSheet, View } from 'react-native';
import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { c, space } from '../lib/theme';
import { errorText, isOffline } from '../lib/errors';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';

export function Loading({ testID = 'loading' }: { testID?: string }) {
  return (
    <View style={styles.center} testID={testID}>
      <ActivityIndicator size="large" color={c.royal} />
    </View>
  );
}

/** Big round icon, title, text and up to two buttons (Empty / Offline boards). */
export function StateView({
  icon,
  iconBg = c.lavender,
  title,
  body,
  action,
  secondary,
  testID,
}: {
  icon: IconName;
  iconBg?: string;
  title: string;
  body?: string;
  action?: { label: string; onPress: () => void };
  secondary?: { label: string; onPress: () => void };
  testID?: string;
}) {
  return (
    <View style={styles.center} testID={testID}>
      <View style={[styles.circle, { backgroundColor: iconBg }]}>
        <Icon name={icon} size={56} strokeWidth={1.5} color={iconBg === c.lavender ? c.royal : c.ink} />
      </View>
      <Txt variant="display" size="xxl" align="center">
        {title}
      </Txt>
      {body ? (
        <Txt size="md" align="center" style={styles.body}>
          {body}
        </Txt>
      ) : null}
      {action || secondary ? (
        <View style={styles.actions}>
          {action ? <Button size="lg" label={action.label} onPress={action.onPress} /> : null}
          {secondary ? <Button size="lg" kind="secondary" label={secondary.label} onPress={secondary.onPress} /> : null}
        </View>
      ) : null}
    </View>
  );
}

export function Offline({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return <StateView testID="offline" icon="wifiOff" iconBg={c.peach} title={t('offline.title')} body={t('offline.body')} action={{ label: t('common.tryAgain'), onPress: onRetry }} />;
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useTranslation();
  if (isOffline(error)) return <Offline onRetry={onRetry} />;
  return <StateView testID="error" icon="alert" iconBg={c.peach} title={t('errors.title')} body={errorText(t, error)} action={{ label: t('common.tryAgain'), onPress: onRetry }} />;
}

export function Empty({ icon = 'search', title, body, action }: { icon?: IconName; title: string; body?: string; action?: { label: string; onPress: () => void } }) {
  return <StateView testID="empty" icon={icon} title={title} body={body} action={action} />;
}

/** Loading → error/offline → content. Keeps showing old data if a refresh fails. */
export function QueryView<T>({ query, children }: { query: UseQueryResult<T>; children: (data: T) => ReactNode }) {
  if (query.data !== undefined) return <>{children(query.data)}</>;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  return <Loading />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg, padding: space.xxl, minHeight: 320 },
  circle: { width: 112, height: 112, borderRadius: 56, alignItems: 'center', justifyContent: 'center' },
  body: { maxWidth: 300, lineHeight: 22 },
  actions: { alignSelf: 'stretch', maxWidth: 320, width: '100%', marginHorizontal: 'auto', gap: space.sm, marginTop: space.sm },
});
