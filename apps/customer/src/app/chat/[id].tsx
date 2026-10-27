// Chat thread (Chat board). Polls every 4 s while open and focused. Sent messages show at once with
// a "Sending…" state; a failed one says so and is sent again with a tap.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View, type TextInputInstance } from 'react-native';
import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { Language, Message } from '@eventseva/app-shared';
import { api, type MessagesPage } from '../../lib/api';
import { CHAT_POLL_MS } from '../../lib/config';
import { errorText } from '../../lib/errors';
import { haptic } from '../../lib/haptics';
import { keys } from '../../lib/queryClient';
import { clockTime } from '../../lib/time';
import { bookingEventText } from '../../lib/bookingEvents';
import { c, radius, space } from '../../lib/theme';
import { useLanguage } from '../../hooks/useLanguage';
import { AppText } from '../../components/AppText';
import { IconButton } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { MessagesSkeleton } from '../../components/Skeleton';
import { EmptyState, ErrorState } from '../../components/States';
import { openLink } from '../../lib/links';

const QUICK = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'] as const;

/** A message typed here that the server has not confirmed yet. */
interface Outgoing {
  key: string;
  body: string;
  status: 'sending' | 'failed';
  error?: string;
  createdAt: string;
  /** Set once the server has it; the bubble stays until that message is in the list, so nothing flickers. */
  sentId?: number;
}

type Row = { kind: 'sent'; message: Message; seen: boolean } | { kind: 'out'; out: Outgoing };

export default function ChatThreadScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const { t } = useTranslation();
  const { lang, fonts } = useLanguage();
  const qc = useQueryClient();
  const focused = useIsFocused();
  const [text, setText] = useState('');
  const [outgoing, setOutgoing] = useState<Outgoing[]>([]);
  const counter = useRef(0);
  const input = useRef<TextInputInstance>(null);

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

  // Newest first, because the list is inverted: unconfirmed messages, then the conversation.
  const rows = useMemo<Row[]>(() => {
    const lastMine = items.find((m) => m.mine);
    const have = new Set(items.map((m) => m.id));
    return [
      ...[...outgoing]
        .reverse()
        .filter((o) => o.sentId == null || !have.has(o.sentId))
        .map((out): Row => ({ kind: 'out', out })),
      ...items.map((message): Row => ({ kind: 'sent', message, seen: message === lastMine && !!message.readAt })),
    ];
  }, [items, outgoing]);

  // Forget sent bubbles once their message is in the list.
  useEffect(() => {
    const have = new Set(items.map((m) => m.id));
    setOutgoing((list) => (list.some((o) => o.sentId != null && have.has(o.sentId)) ? list.filter((o) => o.sentId == null || !have.has(o.sentId)) : list));
  }, [items]);

  const deliver = useCallback(
    async (key: string, body: string) => {
      setOutgoing((list) => list.map((o) => (o.key === key ? { ...o, status: 'sending', error: undefined } : o)));
      try {
        const msg = await api.sendMessage(id, body);
        // Swap the pending bubble for the real message in one render, so it never shows twice.
        qc.setQueryData<InfiniteData<MessagesPage, number | undefined>>(keys.messages(id), (data) =>
          data ? { ...data, pages: data.pages.map((p, i) => (i === 0 ? { ...p, items: [msg, ...p.items.filter((m) => m.id !== msg.id)] } : p)) } : data,
        );
        setOutgoing((list) => list.map((o) => (o.key === key ? { ...o, sentId: msg.id } : o)));
        void qc.invalidateQueries({ queryKey: keys.conversations });
      } catch (e) {
        haptic.error();
        setOutgoing((list) => list.map((o) => (o.key === key ? { ...o, status: 'failed', error: errorText(t, e) } : o)));
      }
    },
    [id, qc, t],
  );

  const submit = () => {
    const body = text.trim();
    if (!body) return;
    counter.current += 1;
    const key = `out-${counter.current}`;
    setOutgoing((list) => [...list, { key, body, status: 'sending', createdAt: new Date().toISOString() }]);
    setText('');
    void deliver(key, body);
  };

  const renderItem = useCallback(
    ({ item }: { item: Row }) =>
      item.kind === 'sent' ? (
        <Bubble message={item.message} seen={item.seen} lang={lang} />
      ) : (
        <OutgoingBubble out={item.out} lang={lang} onRetry={deliver} />
      ),
    [deliver, lang],
  );

  let list;
  if (messages.isPending) list = <MessagesSkeleton />;
  else if (messages.error && items.length === 0) list = <ErrorState error={messages.error} onRetry={() => messages.refetch()} />;
  else if (rows.length === 0) list = <EmptyState compact icon="chat" title={t('chat.startHint')} />;
  else {
    list = (
      <FlashList
        data={rows}
        inverted
        keyExtractor={rowKey}
        getItemType={rowType}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        onEndReached={() => messages.hasNextPage && !messages.isFetchingNextPage && void messages.fetchNextPage()}
        onEndReachedThreshold={0.3}
        keyboardShouldPersistTaps="handled"
      />
    );
  }

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
        {phone ? <IconButton icon="phone" label={t('booking.call')} onPress={() => openLink(`tel:${phone}`)} tone="outline" /> : null}
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
        <View style={[styles.flex, rows.length === 0 && !messages.isPending && styles.center]}>{list}</View>
        {!text ? (
          <ScrollView
            horizontal
            keyboardShouldPersistTaps="handled"
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.quick}
            accessibilityLabel={t('quick.label')}
          >
            {QUICK.map((k) => (
              <Pressable
                key={k}
                testID={`quick-${k}`}
                accessibilityRole="button"
                // Fills the box; the person still decides to send (UX.md §8).
                onPress={() => {
                  haptic.select();
                  setText(t(`quick.replies.${k}`));
                  input.current?.focus();
                }}
                style={({ pressed }) => [styles.quickChip, pressed && styles.pressed]}
              >
                <AppText size="sm" color={c.royal}>
                  {t(`quick.replies.${k}`)}
                </AppText>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        <View style={styles.composer}>
          <View style={styles.inputBox}>
            <TextInput
              ref={input}
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
            disabled={!text.trim()}
            style={({ pressed }) => [styles.send, !text.trim() && styles.sendOff, pressed && styles.pressed]}
          >
            <Icon name="send" size={20} color={c.white} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const rowKey = (r: Row) => (r.kind === 'sent' ? String(r.message.id) : r.out.key);
const rowType = (r: Row) => (r.kind === 'out' ? 'out' : r.message.kind === 'booking' ? 'booking' : r.message.mine ? 'mine' : 'theirs');

/** "Booking confirmed · 4:12 pm · View booking": a small centred line, not a bubble (UX.md §8). */
const BookingLine = memo(function BookingLine({ message: m, lang }: { message: Message; lang: Language }) {
  const { t } = useTranslation();
  const text = bookingEventText(t, m.data, lang);
  return (
    <View style={styles.eventWrap} testID={`booking-line-${m.data?.event}`}>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`${text}. ${t('chatEvents.open')}`}
        disabled={!m.data?.bookingId}
        onPress={() => m.data && router.push({ pathname: '/booking/[id]', params: { id: m.data.bookingId } })}
        style={({ pressed }) => [styles.event, pressed && styles.pressed]}
      >
        <Icon name="calendar" size={14} color={c.royal} />
        <AppText size="sm" variant="bold" color={c.royal} style={styles.eventText}>
          {text}
        </AppText>
      </Pressable>
      <AppText size="xs" color={c.textMuted}>
        {`${clockTime(m.createdAt, lang)} · ${t('chatEvents.open')}`}
      </AppText>
    </View>
  );
});

const Bubble = memo(function Bubble({ message: m, seen, lang }: { message: Message; seen: boolean; lang: Language }) {
  const { t } = useTranslation();
  if (m.kind === 'booking') return <BookingLine message={m} lang={lang} />;
  return (
    <View style={[styles.bubbleWrap, m.mine ? styles.right : styles.left]}>
      <View style={[styles.bubble, m.mine ? styles.mine : styles.theirs]}>
        <AppText size="md" color={m.mine ? c.white : c.text}>
          {m.body}
        </AppText>
      </View>
      <AppText size="xs" color={c.textMuted}>
        {seen ? `${clockTime(m.createdAt, lang)} · ${t('chat.seen')}` : clockTime(m.createdAt, lang)}
      </AppText>
    </View>
  );
});

const OutgoingBubble = memo(function OutgoingBubble({ out, lang, onRetry }: { out: Outgoing; lang: Language; onRetry: (key: string, body: string) => void }) {
  const { t } = useTranslation();
  if (out.status === 'sending') {
    return (
      <View style={[styles.bubbleWrap, styles.right]} accessibilityLabel={`${out.body}. ${t('chat.sending')}`}>
        <View style={[styles.bubble, styles.mine, styles.sending]}>
          <AppText size="md" color={c.white}>
            {out.body}
          </AppText>
        </View>
        <View style={styles.meta}>
          <Icon name="clock" size={12} color={c.textMuted} />
          <AppText size="xs" color={c.textMuted}>
            {`${clockTime(out.createdAt, lang)} · ${t('chat.sending')}`}
          </AppText>
        </View>
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${out.body}. ${t('chat.failed')}`}
      accessibilityHint={out.error}
      onPress={() => onRetry(out.key, out.body)}
      style={({ pressed }) => [styles.bubbleWrap, styles.right, pressed && styles.pressed]}
    >
      <View style={[styles.bubble, styles.failed]}>
        <AppText size="md" color={c.danger}>
          {out.body}
        </AppText>
      </View>
      <View style={styles.meta}>
        <Icon name="alert" size={14} color={c.danger} />
        <AppText size="xs" variant="bold" color={c.danger}>
          {t('chat.failed')}
        </AppText>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { justifyContent: 'center', paddingHorizontal: space.xl },
  pressed: { opacity: 0.85 },
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
  list: { paddingHorizontal: space.xl, paddingVertical: space.lg },
  bubbleWrap: { maxWidth: '78%', gap: 2, marginVertical: 5 },
  right: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  left: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  bubble: { paddingVertical: 10, paddingHorizontal: 14 },
  mine: { backgroundColor: c.royal, borderTopLeftRadius: 16, borderTopRightRadius: 16, borderBottomLeftRadius: 16, borderBottomRightRadius: 4 },
  theirs: { backgroundColor: c.white, borderTopLeftRadius: 16, borderTopRightRadius: 16, borderBottomRightRadius: 16, borderBottomLeftRadius: 4 },
  sending: { opacity: 0.7 },
  failed: {
    backgroundColor: c.dangerBg,
    borderWidth: 1.5,
    borderColor: c.danger,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 4,
  },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
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
  sendOff: { opacity: 0.45 },
  eventWrap: { alignItems: 'center', gap: 2, marginVertical: space.sm },
  event: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.lavender, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 6, maxWidth: '90%' },
  eventText: { flexShrink: 1 },
  quick: { gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm },
  quickChip: { borderWidth: 1.5, borderColor: c.outline, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 8, backgroundColor: c.white },
});
