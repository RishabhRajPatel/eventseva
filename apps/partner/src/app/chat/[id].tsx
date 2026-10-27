import { memo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View, type TextInputInstance } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { isUuid, type Message } from '@eventseva/app-shared';
import { api } from '../../lib/api';
import { errorText } from '../../lib/errors';
import { keys, useConversations, useMessages, type MessagePage } from '../../lib/queries';
import { shortTime } from '../../lib/time';
import { bookingEventText } from '../../lib/bookingEvents';
import { c, radius, space, text, TOUCH } from '../../lib/theme';
import { toast } from '../../lib/toast';
import { haptic } from '../../lib/haptics';
import { useLang } from '../../hooks/useLang';
import { Avatar } from '../../components/Avatar';
import { IconButton } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { QueryView } from '../../components/States';
import { Txt, useFonts } from '../../components/Txt';

/** One chat with a customer (PartnerChat board). Polls every 4 s while open. */
export default function ChatThread() {
  const { t } = useTranslation();
  const lang = useLang();
  const f = useFonts();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const focused = useIsFocused();
  const messages = useMessages(id, focused);
  const conversations = useConversations();
  const customerName = name || conversations.data?.find((x) => x.id === id)?.customerName || t('booking.customerFallback');
  const [draft, setDraft] = useState('');
  const input = useRef<TextInputInstance>(null);

  const send = useMutation({
    mutationFn: (body: string) => api.post<Message>(`/v1/conversations/${id}/messages`, { body }),
    onSuccess: (msg) => {
      setDraft('');
      haptic.tap();
      qc.setQueryData<MessagePage>(keys.messages(id), (old) => (old ? { ...old, items: [msg, ...old.items.filter((m) => m.id !== msg.id)] } : old));
      void qc.invalidateQueries({ queryKey: keys.conversations });
    },
    // The draft stays in the box, so nothing typed is lost.
    onError: (e) => toast.error(errorText(t, e)),
  });

  const submit = () => {
    const body = draft.trim();
    if (body && !send.isPending) send.mutate(body);
  };

  return (
    <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined} testID="chat-thread">
      <View style={[styles.header, { paddingTop: insets.top + space.md }]}>
        <IconButton icon="back" label={t('common.back')} bg={c.lavender} color={c.royal} onPress={() => (router.canGoBack() ? router.back() : router.replace('/chat'))} />
        <Avatar name={customerName} size={40} />
        <View style={{ flex: 1 }}>
          <Txt variant="bold" size="lg" numberOfLines={1} accessibilityRole="header">
            {t('chat.customerLabel', { name: customerName })}
          </Txt>
        </View>
      </View>
      <QueryView query={messages} skeleton="rows" padded>
        {(page) => (
          <>
            {!page.phoneShared ? (
              <View style={styles.hint} testID="phone-hint">
                <Icon name="lock" size={16} color={c.royal} />
                <Txt size="xs" style={{ flex: 1, lineHeight: 17 }}>
                  {t('chat.phoneHint')}
                </Txt>
              </View>
            ) : null}
            {page.items.length ? (
              <FlashList inverted data={page.items} keyExtractor={keyOf} contentContainerStyle={styles.list} ItemSeparatorComponent={Gap} renderItem={({ item }) => <Bubble item={item} lang={lang} />} />
            ) : (
              // Outside the inverted list, so it is not drawn upside down.
              <View style={styles.empty} testID="chat-empty">
                <Icon name="chat" size={28} color={c.royal} />
                <Txt align="center" color={c.textMuted}>
                  {t('chat.startHint')}
                </Txt>
              </View>
            )}
          </>
        )}
      </QueryView>
      {!draft ? (
        <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quick} style={styles.quickBar}>
          {QUICK.map((k) => (
            <Pressable
              key={k}
              testID={`quick-${k}`}
              accessibilityRole="button"
              // Fills the box; the vendor still decides to send.
              onPress={() => {
                haptic.select();
                setDraft(t(`quick.replies.${k}`));
                input.current?.focus();
              }}
              style={({ pressed }) => [styles.quickChip, pressed && { opacity: 0.85 }]}
            >
              <Txt size="sm" color={c.royal}>
                {t(`quick.replies.${k}`)}
              </Txt>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      <View style={[styles.composer, { paddingBottom: insets.bottom + space.md }]}>
        <View style={styles.inputWrap}>
          <TextInput
            ref={input}
            testID="message-input"
            value={draft}
            onChangeText={setDraft}
            placeholder={t('chat.placeholder')}
            placeholderTextColor={c.muted}
            accessibilityLabel={t('chat.placeholder')}
            multiline
            maxLength={1000}
            style={[styles.input, { fontFamily: f.body }]}
          />
        </View>
        <Pressable
          testID="send"
          accessibilityRole="button"
          accessibilityLabel={t('chat.send')}
          accessibilityState={{ disabled: !draft.trim(), busy: send.isPending }}
          onPress={submit}
          style={({ pressed }) => [styles.send, { opacity: !draft.trim() ? 0.5 : pressed ? 0.85 : 1 }]}
        >
          {send.isPending ? <ActivityIndicator color={c.white} /> : <Icon name="send" size={20} color={c.white} />}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const QUICK = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'] as const;
const keyOf = (m: Message) => String(m.id);
const Gap = () => <View style={styles.gap} />;

const Bubble = memo(function Bubble({ item, lang }: { item: Message; lang: 'en' | 'hi' }) {
  const { t } = useTranslation();
  if (item.kind === 'booking') {
    const text = bookingEventText(t, item.data, lang);
    return (
      <View style={styles.eventWrap} testID={`booking-line-${item.data?.event}`}>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`${text}. ${t('chatEvents.open')}`}
          disabled={!isUuid(item.data?.bookingId)}
          onPress={() => item.data && router.push(`/booking/${item.data.bookingId}`)}
          style={({ pressed }) => [styles.event, pressed && { opacity: 0.85 }]}
        >
          <Icon name="calendar" size={14} color={c.royal} />
          <Txt size="sm" variant="bold" color={c.royal} style={{ flexShrink: 1 }}>
            {text}
          </Txt>
        </Pressable>
        <Txt size="xs" color={c.textMuted}>
          {`${shortTime(item.createdAt, lang)} · ${t('chatEvents.open')}`}
        </Txt>
      </View>
    );
  }
  return (
    <View style={[styles.bubble, item.mine ? styles.mine : styles.theirs]}>
      <Txt size="md" color={item.mine ? c.white : c.ink} style={{ lineHeight: 21 }}>
        {item.body}
      </Txt>
      <Txt size="xs" color={item.mine ? c.lavender : c.textMuted} align="right">
        {shortTime(item.createdAt, lang)}
        {item.mine && item.readAt ? ` · ${t('chat.seen')}` : ''}
      </Txt>
    </View>
  );
});

const styles = StyleSheet.create({
  gap: { height: 10 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm, padding: space.xl },
  page: { flex: 1, backgroundColor: c.cream },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.xl, paddingBottom: space.md, backgroundColor: c.white, borderBottomWidth: 1, borderBottomColor: c.lavender },
  hint: { margin: space.md, marginHorizontal: space.xl, marginBottom: 0, borderRadius: radius.md, backgroundColor: c.lavender, padding: 10, paddingHorizontal: 14, flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  list: { padding: space.xl },
  bubble: { maxWidth: '78%', paddingVertical: 10, paddingHorizontal: 14, gap: 2 },
  mine: { alignSelf: 'flex-end', backgroundColor: c.royal, borderRadius: radius.lg, borderBottomRightRadius: 4 },
  theirs: { alignSelf: 'flex-start', backgroundColor: c.white, borderRadius: radius.lg, borderBottomLeftRadius: 4 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, paddingHorizontal: space.xl, paddingTop: space.md, backgroundColor: c.white, borderTopWidth: 1, borderTopColor: c.lavender },
  inputWrap: { flex: 1, minHeight: TOUCH, borderRadius: radius.xl, backgroundColor: c.cream, justifyContent: 'center', paddingHorizontal: space.lg },
  input: { fontSize: text.md + 1, color: c.ink, maxHeight: 120, paddingVertical: space.sm },
  eventWrap: { alignItems: 'center', gap: 2 },
  event: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.lavender, borderRadius: 999, paddingHorizontal: space.md, paddingVertical: 6, maxWidth: '90%' },
  quickBar: { backgroundColor: c.white, flexGrow: 0 },
  quick: { gap: space.sm, paddingHorizontal: space.xl, paddingTop: space.sm },
  quickChip: { borderWidth: 1.5, borderColor: c.outline, borderRadius: 999, paddingHorizontal: space.md, paddingVertical: 8, backgroundColor: c.white },
  send: { width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, backgroundColor: c.royal, alignItems: 'center', justifyContent: 'center' },
});
