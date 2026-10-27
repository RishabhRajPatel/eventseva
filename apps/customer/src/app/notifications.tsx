// Notifications: tapping one opens its booking or chat.
import { memo, useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { AppNotification, Language } from '@eventseva/app-shared';
import { api } from '../lib/api';
import { notificationTarget } from '../lib/notifications';
import { keys } from '../lib/queryClient';
import { shortWhen } from '../lib/time';
import { c, radius, space } from '../lib/theme';
import { useLanguage } from '../hooks/useLanguage';
import { AppText } from '../components/AppText';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { Screen, ScreenHeader } from '../components/Screen';
import { NotificationsSkeleton } from '../components/Skeleton';
import { EmptyState, ErrorState } from '../components/States';

const Separator = () => <View style={styles.separator} />;

export default function NotificationsScreen() {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: keys.notifications, queryFn: api.notifications });
  const markRead = useMutation({
    mutationFn: () => api.markNotificationsRead(),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.notifications }),
  });
  const unread = list.data?.unreadCount ?? 0;

  // Seeing the list counts as reading it; the unread ones stay highlighted until the next visit.
  useEffect(() => {
    if (unread > 0) markRead.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread > 0]);

  let body;
  if (list.isPending) body = <NotificationsSkeleton />;
  else if (list.error) body = <ErrorState error={list.error} onRetry={() => list.refetch()} />;
  else {
    body = (
      <FlashList
        data={list.data.items}
        keyExtractor={(n) => String(n.id)}
        renderItem={({ item }) => <NotificationRow item={item} lang={lang} />}
        ItemSeparatorComponent={Separator}
        contentContainerStyle={styles.list}
        refreshing={list.isRefetching}
        onRefresh={() => void list.refetch()}
        ListEmptyComponent={
          <EmptyState
            icon="bell"
            title={t('notifications.emptyTitle')}
            body={t('notifications.emptyBody')}
            actions={<Button label={t('events.findVendors')} onPress={() => router.navigate('/search')} />}
          />
        }
      />
    );
  }

  return (
    <Screen>
      <ScreenHeader title={t('notifications.title')} />
      {body}
    </Screen>
  );
}

const NotificationRow = memo(function NotificationRow({ item, lang }: { item: AppNotification; lang: Language }) {
  const { t } = useTranslation();
  const target = notificationTarget(item);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.readAt ? '' : `${t('notifications.new')}. `}${item.title}. ${item.body}`}
      disabled={!target}
      onPress={() => target && router.push(target)}
      style={({ pressed }) => [styles.row, !item.readAt && styles.unread, pressed && styles.pressed]}
    >
      <View style={styles.icon}>
        <Icon name={item.data.conversationId ? 'chat' : 'bell'} size={18} color={c.royal} />
      </View>
      <View style={styles.text}>
        <View style={styles.titleRow}>
          <AppText variant="bold" size="md" style={styles.flex}>
            {item.title}
          </AppText>
          {!item.readAt ? <View style={styles.dot} /> : null}
        </View>
        <AppText size="sm">{item.body}</AppText>
        <AppText size="xs" color={c.textMuted}>
          {shortWhen(item.createdAt, lang)}
        </AppText>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { paddingBottom: space.xxxl },
  separator: { height: space.sm },
  row: { backgroundColor: c.white, borderRadius: radius.lg, padding: space.md, flexDirection: 'row', gap: space.md, minHeight: 64, borderWidth: 2, borderColor: c.white },
  unread: { borderColor: c.lilac },
  pressed: { opacity: 0.85 },
  icon: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.lavender, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: c.royal },
});
