import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { AppNotification } from '@eventseva/app-shared';
import { api } from '../lib/api';
import { keys, useNotifications } from '../lib/queries';
import { notificationTarget } from '../lib/notifications';
import { shortTime } from '../lib/time';
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
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.notifications }),
  });

  const open = (n: AppNotification) => {
    if (!n.readAt) markRead.mutate([n.id]);
    const target = notificationTarget(n);
    if (target) router.push(target as never);
  };

  return (
    <Screen
      back
      title={t('notifications.title')}
      refreshing={notifications.isRefetching}
      onRefresh={() => void notifications.refetch()}
      right={notifications.data?.unreadCount ? <LinkButton testID="mark-all" label={t('notifications.markAll')} onPress={() => markRead.mutate(undefined)} /> : null}
      testID="notifications"
    >
      <QueryView query={notifications}>
        {(page) =>
          page.items.length ? (
            page.items.map((n) => (
              <Card key={n.id} testID={`notification-${n.id}`} onPress={() => open(n)} style={[styles.row, !n.readAt ? styles.unread : null]} accessibilityLabel={n.title}>
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
            ))
          ) : (
            <Empty icon="bell" title={t('notifications.emptyTitle')} body={t('notifications.emptyBody')} />
          )
        }
      </QueryView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  unread: { borderLeftWidth: 4, borderLeftColor: c.royal },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.royal, marginTop: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
