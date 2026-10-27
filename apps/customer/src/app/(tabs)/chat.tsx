// Chat list: one conversation per vendor.
import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useIsFocused } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { Conversation, Language } from '@eventseva/app-shared';
import { api } from '../../lib/api';
import { keys } from '../../lib/queryClient';
import { shortWhen } from '../../lib/time';
import { c, radius, space } from '../../lib/theme';
import { useLayout } from '../../hooks/useLayout';
import { useLanguage } from '../../hooks/useLanguage';
import { AppText } from '../../components/AppText';
import { Button } from '../../components/Button';
import { ChatRowsSkeleton } from '../../components/Skeleton';
import { EmptyState, ErrorState } from '../../components/States';

const Separator = () => <View style={styles.separator} />;

export default function ChatListScreen() {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const { gutter, isTablet } = useLayout();
  const focused = useIsFocused();
  const list = useQuery({ queryKey: keys.conversations, queryFn: api.conversations, refetchInterval: focused ? 15_000 : false });
  const renderItem = useCallback(({ item }: { item: Conversation }) => <ConversationRow conversation={item} lang={lang} />, [lang]);
  const pad = [{ paddingHorizontal: gutter }, isTablet && styles.tablet];

  let body;
  if (list.isPending) {
    body = (
      <View style={pad}>
        <ChatRowsSkeleton />
      </View>
    );
  } else if (list.error) body = <ErrorState error={list.error} onRetry={() => list.refetch()} />;
  else {
    body = (
      <View style={[styles.flex, isTablet && styles.tablet]}>
      <FlashList
        data={list.data.items}
        keyExtractor={(cv) => cv.id}
        renderItem={renderItem}
        ItemSeparatorComponent={Separator}
        contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: space.xxxl }}
        refreshing={list.isRefetching}
        onRefresh={() => void list.refetch()}
        ListEmptyComponent={
          <EmptyState
            icon="chat"
            title={t('chat.emptyTitle')}
            body={t('chat.emptyBody')}
            actions={<Button label={t('events.findVendors')} onPress={() => router.navigate('/search')} />}
          />
        }
      />
      </View>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={styles.flex}>
      <View style={[styles.head, ...pad]}>
        <AppText variant="display" size="display" accessibilityRole="header">
          {t('chat.title')}
        </AppText>
      </View>
      {body}
    </SafeAreaView>
  );
}

const ConversationRow = memo(function ConversationRow({ conversation: cv, lang }: { conversation: Conversation; lang: Language }) {
  const { t } = useTranslation();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${cv.vendorName}${cv.unreadCount ? `, ${t('chat.unread', { count: cv.unreadCount })}` : ''}`}
      onPress={() => router.push({ pathname: '/chat/[id]', params: { id: cv.id, name: cv.vendorName } })}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.avatar}>
        <AppText variant="bold" size="lg" color={c.royal}>
          {cv.vendorName.slice(0, 1).toUpperCase()}
        </AppText>
      </View>
      <View style={styles.text}>
        <View style={styles.top}>
          <AppText variant="bold" size="md" numberOfLines={1} style={styles.flex}>
            {cv.vendorName}
          </AppText>
          {cv.lastMessageAt ? <AppText size="xs">{shortWhen(cv.lastMessageAt, lang)}</AppText> : null}
        </View>
        <View style={styles.top}>
          <AppText size="sm" numberOfLines={1} style={styles.flex} variant={cv.unreadCount ? 'bold' : 'body'}>
            {cv.lastMessage ?? t('chat.noMessages')}
          </AppText>
          {cv.unreadCount ? (
            <View style={styles.badge}>
              <AppText variant="bold" size={11} color={c.white}>
                {String(cv.unreadCount)}
              </AppText>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  head: { paddingTop: space.xxl + space.xs, paddingBottom: space.md },
  separator: { height: space.sm },
  tablet: { width: '100%', maxWidth: 760, alignSelf: 'center' },
  row: { backgroundColor: c.white, borderRadius: radius.lg, padding: space.md, flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 72 },
  pressed: { opacity: 0.85 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: c.lilac, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  badge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: c.royal, alignItems: 'center', justifyContent: 'center' },
});
