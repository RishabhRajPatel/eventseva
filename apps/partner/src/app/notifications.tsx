import { memo, useCallback } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { AppNotification } from '@eventseva/app-shared';
import { api } from '../lib/api';
import { keys, useNotifications, type NotificationPage } from '../lib/queries';
import { notificationTarget } from '../lib/notifications';
import { shortTime } from '../lib/time';
import { toast } from '../lib/toast';
import { errorText } from '../lib/errors';
import { c, space } from '../lib/theme';
import { useLang } from '../hooks/useLang';
import { LinkButton } from '../components/Button';
import { Card } from '../components/Card';
import { Screen } from '../components/Screen';
import { Empty, QueryView } from '../components/States';
import { Txt } from '../components/Txt';

export default function NotificationsScreen() {
  const { t } = useTranslation();
  const lang = useLang();
  const qc = useQueryClient();
  const notifications = useNotifications();
  const markRead = useMutation({
    mutationFn: (ids?: number[]) => api.post('/v1/notifications/read', ids ? { ids } : {}),
    // Mark as read at once; the refetch confirms it.
    onMutate: (ids) => {
      qc.setQueryData<NotificationPage>(keys.notifications, (old) => {
        if (!old) return old;
        const now = new Date().toISOString();
        const items = old.items.map((n) => (!ids || ids.includes(n.id) ? { ...n, readAt: n.readAt ?? now } : n));
        return { ...old, items, unreadCount: items.filter((n) => !n.readAt).length };
      });
    },
    onSuccess: (_r, ids) => {
      if (!ids) toast.success(t('notifications.allRead'));
    },
    onError: (e) => toast.error(errorText(t, e)),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.notifications }),
  });

  const open = useCallback(
    (n: AppNotification) => {
      if (!n.readAt) markRead.mutate([n.id]);
      const target = notificationTarget(n);
      if (target) router.push(target as never);
    },
    [markRead],
  );

  return (
    <Screen
      back
      scroll={false}
      title={t('notifications.title')}
      right={notifications.data?.unreadCount ? <LinkButton testID="mark-all" label={t('notifications.markAll')} onPress={() => markRead.mutate(undefined)} /> : null}
      testID="notifications"
    >
      <QueryView query={notifications} skeleton="rows" padded>
        {(page) => (
          <FlashList
            data={page.items}
            keyExtractor={keyOf}
            contentContainerStyle={styles.list}
            ItemSeparatorComponent={Gap}
            refreshControl={<RefreshControl refreshing={notifications.isRefetching} onRefresh={() => void notifications.refetch()} colors={[c.royal]} />}
            renderItem={({ item }) => <NotificationRow n={item} lang={lang} onOpen={open} />}
            ListEmptyComponent={<Empty icon="bell" title={t('notifications.emptyTitle')} body={t('notifications.emptyBody')} />}
          />
        )}
      </QueryView>
    </Screen>
  );
}

const keyOf = (n: AppNotification) => String(n.id);
const Gap = () => <View style={styles.gap} />;

const NotificationRow = memo(function NotificationRow({ n, lang, onOpen }: { n: AppNotification; lang: 'en' | 'hi'; onOpen: (n: AppNotification) => void }) {
  const { t } = useTranslation();
  return (
    <Card testID={`notification-${n.id}`} onPress={() => onOpen(n)} style={[styles.row, !n.readAt ? styles.unread : null]} accessibilityLabel={n.readAt ? n.title : t('notifications.unreadLabel', { title: n.title })}>
      {!n.readAt ? <View style={styles.dot} /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <View style={styles.head}>
          <Txt variant="bold" size="md" style={{ flex: 1 }}>
            {n.title}
          </Txt>
          <Txt size="xs" color={c.textMuted}>
            {shortTime(n.createdAt, lang)}
          </Txt>
        </View>
        <Txt size="sm" style={{ lineHeight: 19 }}>
          {n.body}
        </Txt>
      </View>
    </Card>
  );
});

const styles = StyleSheet.create({
  list: { paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.xxxl },
  gap: { height: space.md },
  row: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  unread: { borderLeftWidth: 4, borderLeftColor: c.royal },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.royal, marginTop: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
