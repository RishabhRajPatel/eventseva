// Notifications: tapping one opens its booking or chat.
import { useEffect } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { notificationTarget } from '../lib/notifications';
import { keys } from '../lib/queryClient';
import { shortWhen } from '../lib/time';
import { c, radius, space } from '../lib/theme';
import { useLanguage } from '../hooks/useLanguage';
import { AppText } from '../components/AppText';
import { Icon } from '../components/Icon';
import { Screen, ScreenHeader } from '../components/Screen';
import { EmptyState, ErrorState, Loading } from '../components/States';

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
  if (list.isPending) body = <Loading />;
  else if (list.error) body = <ErrorState error={list.error} onRetry={() => list.refetch()} />;
  else if (list.data.items.length === 0) body = <EmptyState icon="bell" title={t('notifications.emptyTitle')} body={t('notifications.emptyBody')} />;
  else {
    body = (
      <FlatList
        data={list.data.items}
        keyExtractor={(n) => String(n.id)}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} colors={[c.royal]} />}
        renderItem={({ item }) => {
          const target = notificationTarget(item);
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.title}. ${item.body}`}
              disabled={!target}
              onPress={() => target && router.push(target)}
              style={({ pressed }) => [styles.row, !item.readAt && styles.unread, pressed && { opacity: 0.85 }]}
            >
              <View style={styles.icon}>
                <Icon name={item.data.conversationId ? 'chat' : 'bell'} size={18} color={c.royal} />
              </View>
              <View style={styles.text}>
                <AppText variant="bold" size="md">
                  {item.title}
                </AppText>
                <AppText size="sm">{item.body}</AppText>
                <AppText size="xs" color={c.textMuted}>
                  {shortWhen(item.createdAt, lang)}
                </AppText>
              </View>
            </Pressable>
          );
        }}
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

const styles = StyleSheet.create({
  list: { gap: space.sm, paddingBottom: space.xxxl },
  row: { backgroundColor: c.white, borderRadius: radius.lg, padding: space.md, flexDirection: 'row', gap: space.md, minHeight: 64 },
  unread: { borderWidth: 2, borderColor: c.lilac },
  icon: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.lavender, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
});
