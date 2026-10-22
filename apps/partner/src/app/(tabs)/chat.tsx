import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useConversations } from '../../lib/queries';
import { shortTime } from '../../lib/time';
import { c, space } from '../../lib/theme';
import { useLang } from '../../hooks/useLang';
import { Avatar } from '../../components/Avatar';
import { Card } from '../../components/Card';
import { Empty, QueryView } from '../../components/States';
import { Txt } from '../../components/Txt';

/** Customer chats, newest first. */
export default function ChatList() {
  const { t } = useTranslation();
  const lang = useLang();
  const insets = useSafeAreaInsets();
  const conversations = useConversations(true);
  return (
    <View style={[styles.page, { paddingTop: insets.top }]} testID="chat-list">
      <View style={styles.head}>
        <Txt variant="display" size="display" accessibilityRole="header">
          {t('chat.title')}
        </Txt>
      </View>
      <QueryView query={conversations}>
        {(items) => (
          <FlatList
            data={items}
            keyExtractor={(i) => i.id}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={conversations.isRefetching} onRefresh={() => void conversations.refetch()} colors={[c.royal]} />}
            ListEmptyComponent={<Empty icon="chat" title={t('chat.emptyTitle')} body={t('chat.emptyBody')} />}
            renderItem={({ item }) => (
              <Card
                testID={`conversation-${item.id}`}
                onPress={() => router.push({ pathname: '/chat/[id]', params: { id: item.id, name: item.customerName } })}
                style={styles.row}
                accessibilityLabel={item.customerName}
              >
                <Avatar name={item.customerName} />
                <View style={{ flex: 1 }}>
                  <View style={styles.top}>
                    <Txt variant="bold" size="md" numberOfLines={1} style={{ flex: 1 }}>
                      {item.customerName}
                    </Txt>
                    {item.lastMessageAt ? (
                      <Txt size="xs" color={c.textMuted}>
                        {shortTime(item.lastMessageAt, lang)}
                      </Txt>
                    ) : null}
                  </View>
                  <View style={styles.top}>
                    <Txt size="sm" numberOfLines={1} style={{ flex: 1 }} color={item.unreadCount ? c.ink : c.textMuted} variant={item.unreadCount ? 'bold' : 'body'}>
                      {item.lastMessage ?? t('chat.noMessages')}
                    </Txt>
                    {item.unreadCount ? (
                      <View style={styles.badge}>
                        <Txt variant="bold" size="xs" color={c.white}>
                          {item.unreadCount}
                        </Txt>
                      </View>
                    ) : null}
                  </View>
                </View>
              </Card>
            )}
          />
        )}
      </QueryView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: c.cream },
  head: { paddingHorizontal: space.xl, paddingTop: space.xxl, paddingBottom: space.lg },
  list: { paddingHorizontal: space.xl, paddingBottom: space.xxxl, gap: space.sm, width: '100%', maxWidth: 760, alignSelf: 'center', flexGrow: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  badge: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: c.royal, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
});
