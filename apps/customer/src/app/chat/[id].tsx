// Chat thread (Chat board). Polls every 4 s while open and focused.
import { useMemo, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Linking, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { Message } from '@eventseva/app-shared';
import { api, type MessagesPage } from '../../lib/api';
import { CHAT_POLL_MS } from '../../lib/config';
import { errorText } from '../../lib/errors';
import { keys } from '../../lib/queryClient';
import { clockTime } from '../../lib/time';
import { c, radius, space } from '../../lib/theme';
import { useLanguage } from '../../hooks/useLanguage';
import { AppText } from '../../components/AppText';
import { IconButton } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { ErrorState, Loading } from '../../components/States';


export default function ChatThreadScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const { t } = useTranslation();
  const { lang, fonts } = useLanguage();
  const qc = useQueryClient();
  const focused = useIsFocused();
  const [text, setText] = useState('');

  const messages = useInfiniteQuery({
    queryKey: keys.messages(id),
    queryFn: ({ pageParam }) => api.messages(id, pageParam),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => (last.hasMore ? last.items[last.items.length - 1]?.id : undefined),
    refetchInterval: focused ? CHAT_POLL_MS : false,
  });
  // Vendor name and phone: the list gives the vendor, a confirmed booking gives the phone.
  const conversations = useQuery({ queryKey: keys.conversations, queryFn: api.conversations });
  const conv = conversations.data?.items.find((cv) => cv.id === id);
  const bookings = useQuery({ queryKey: keys.bookings(), queryFn: () => api.bookings(), enabled: !!conv?.hasBooking });
  const phone = bookings.data?.items.find((b) => b.vendor.id === conv?.vendorId && b.vendor.phone && b.status === 'confirmed')?.vendor.phone;

  const items = useMemo(() => messages.data?.pages.flatMap((p) => p.items) ?? [], [messages.data]);
  const phoneShared = messages.data?.pages[0]?.phoneShared ?? false;
  const title = conv?.vendorName ?? name ?? t('chat.title');
  const lastMineSeen = items.find((m) => m.mine)?.readAt;

  const send = useMutation({
    mutationFn: (body: string) => api.sendMessage(id, body),
    onSuccess: (msg: Message) => {
      setText('');
      qc.setQueryData<InfiniteData<MessagesPage, number | undefined>>(keys.messages(id), (data) =>
        data ? { ...data, pages: data.pages.map((p, i) => (i === 0 ? { ...p, items: [msg, ...p.items.filter((m) => m.id !== msg.id)] } : p)) } : data,
      );
      void qc.invalidateQueries({ queryKey: keys.conversations });
    },
  });
  const submit = () => {
    const body = text.trim();
    if (body && !send.isPending) send.mutate(body);
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.flex}>
      <View style={styles.header}>
        <IconButton icon="back" label={t('common.back')} onPress={() => (router.canGoBack() ? router.back() : router.navigate('/chat'))} tone="lavender" />
        <View style={styles.avatar}>
          <AppText variant="bold" size="md" color={c.royal}>
            {title.slice(0, 1).toUpperCase()}
          </AppText>
        </View>
        <View style={styles.flex}>
          <AppText variant="bold" size="lg" numberOfLines={1} accessibilityRole="header">
            {title}
          </AppText>
          <AppText size="xs">{phoneShared ? t('chat.bookingConfirmed') : t('chat.subtitle')}</AppText>
        </View>
        {phone ? <IconButton icon="phone" label={t('booking.call')} onPress={() => Linking.openURL(`tel:${phone}`)} tone="outline" /> : null}
      </View>

      {!phoneShared && !messages.isPending ? (
        <View style={styles.hint}>
          <Icon name="lock" size={16} color={c.royal} />
          <AppText size="xs" style={styles.flex}>
            {t('chat.phoneHint')}
          </AppText>
        </View>
      ) : null}

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {messages.isPending ? (
          <Loading />
        ) : messages.error && items.length === 0 ? (
          <ErrorState error={messages.error} onRetry={() => messages.refetch()} />
        ) : (
          <FlatList
            data={items}
            inverted
            keyExtractor={(m) => String(m.id)}
            contentContainerStyle={styles.list}
            onEndReached={() => messages.hasNextPage && !messages.isFetchingNextPage && messages.fetchNextPage()}
            onEndReachedThreshold={0.3}
            ListEmptyComponent={
              <AppText size="sm" align="center" style={styles.empty}>
                {t('chat.startHint')}
              </AppText>
            }
            renderItem={({ item, index }) => (
              <View style={[styles.bubbleWrap, item.mine ? styles.right : styles.left]}>
                <View style={[styles.bubble, item.mine ? styles.mine : styles.theirs]}>
                  <AppText size="md" color={item.mine ? c.white : c.text}>
                    {item.body}
                  </AppText>
                </View>
                <AppText size="xs" color={c.textMuted}>
                  {index === 0 && item.mine && lastMineSeen ? `${clockTime(item.createdAt, lang)} · ${t('chat.seen')}` : clockTime(item.createdAt, lang)}
                </AppText>
              </View>
            )}
          />
        )}

        {send.error ? (
          <AppText size="sm" color={c.danger} align="center">
            {errorText(t, send.error)}
          </AppText>
        ) : null}
        <View style={styles.composer}>
          <View style={styles.inputBox}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder={t('chat.placeholder')}
              placeholderTextColor={c.textMuted}
              accessibilityLabel={t('chat.messageLabel')}
              multiline
              maxLength={1000}
              style={[styles.input, { fontFamily: fonts.body }]}
            />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('chat.send')}
            accessibilityState={{ disabled: !text.trim() }}
            onPress={submit}
            disabled={!text.trim() || send.isPending}
            style={[styles.send, (!text.trim() || send.isPending) && styles.sendOff]}
          >
            <Icon name="send" size={20} color={c.white} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.xl,
    paddingTop: space.lg,
    paddingBottom: space.md,
    backgroundColor: c.white,
    borderBottomWidth: 1,
    borderBottomColor: c.lavender,
  },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.lilac, alignItems: 'center', justifyContent: 'center' },
  hint: {
    marginHorizontal: space.xl,
    marginTop: space.md,
    borderRadius: radius.md,
    backgroundColor: c.lavender,
    paddingVertical: 10,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  list: { paddingHorizontal: space.xl, paddingVertical: space.lg, gap: 10, flexGrow: 1 },
  empty: { marginTop: space.xxl, transform: [{ scaleY: -1 }] },
  bubbleWrap: { maxWidth: '78%', gap: 2 },
  right: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  left: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  bubble: { paddingVertical: 10, paddingHorizontal: 14 },
  mine: { backgroundColor: c.royal, borderTopLeftRadius: 16, borderTopRightRadius: 16, borderBottomLeftRadius: 16, borderBottomRightRadius: 4 },
  theirs: { backgroundColor: c.white, borderTopLeftRadius: 16, borderTopRightRadius: 16, borderBottomRightRadius: 16, borderBottomLeftRadius: 4 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    paddingBottom: space.md,
    backgroundColor: c.white,
    borderTopWidth: 1,
    borderTopColor: c.lavender,
  },
  inputBox: { flex: 1, minHeight: 48, maxHeight: 120, borderRadius: 24, backgroundColor: c.cream, paddingHorizontal: space.lg, justifyContent: 'center' },
  input: { fontSize: 16, color: c.text, paddingVertical: 12 },
  send: { width: 48, height: 48, borderRadius: 24, backgroundColor: c.royal, alignItems: 'center', justifyContent: 'center' },
  sendOff: { opacity: 0.5 },
});
