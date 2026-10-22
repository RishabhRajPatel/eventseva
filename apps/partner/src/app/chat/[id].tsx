import { useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { Message } from '@eventseva/app-shared';
import { api } from '../../lib/api';
import { errorText } from '../../lib/errors';
import { keys, useConversations, useMessages, type MessagePage } from '../../lib/queries';
import { shortTime } from '../../lib/time';
import { c, radius, space, text, TOUCH } from '../../lib/theme';
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

  const send = useMutation({
    mutationFn: (body: string) => api.post<Message>(`/v1/conversations/${id}/messages`, { body }),
    onSuccess: (msg) => {
      setDraft('');
      qc.setQueryData<MessagePage>(keys.messages(id), (old) => (old ? { ...old, items: [msg, ...old.items.filter((m) => m.id !== msg.id)] } : old));
      void qc.invalidateQueries({ queryKey: keys.conversations });
    },
    onError: (e) => Alert.alert(t('errors.title'), errorText(t, e)),
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
      <QueryView query={messages}>
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
            <FlatList
              inverted
              data={page.items}
              keyExtractor={(m) => String(m.id)}
              contentContainerStyle={styles.list}
              renderItem={({ item }) => (
                <View style={[styles.bubble, item.mine ? styles.mine : styles.theirs]}>
                  <Txt size="md" color={item.mine ? c.white : c.ink} style={{ lineHeight: 21 }}>
                    {item.body}
                  </Txt>
                  <Txt size="xs" color={item.mine ? c.lavender : c.textMuted} align="right">
                    {shortTime(item.createdAt, lang)}
                    {item.mine && item.readAt ? ` · ${t('chat.seen')}` : ''}
                  </Txt>
                </View>
              )}
              ListEmptyComponent={
                <View style={{ transform: [{ scaleY: -1 }], padding: space.xl }}>
                  <Txt align="center" color={c.textMuted}>
                    {t('chat.startHint')}
                  </Txt>
                </View>
              }
            />
          </>
        )}
      </QueryView>
      <View style={[styles.composer, { paddingBottom: insets.bottom + space.md }]}>
        <View style={styles.inputWrap}>
          <TextInput
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
        <Pressable testID="send" accessibilityRole="button" accessibilityLabel={t('chat.send')} onPress={submit} style={[styles.send, { opacity: draft.trim() ? 1 : 0.5 }]}>
          <Icon name="send" size={20} color={c.white} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: c.cream },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.xl, paddingBottom: space.md, backgroundColor: c.white, borderBottomWidth: 1, borderBottomColor: c.lavender },
  hint: { margin: space.md, marginHorizontal: space.xl, marginBottom: 0, borderRadius: radius.md, backgroundColor: c.lavender, padding: 10, paddingHorizontal: 14, flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  list: { padding: space.xl, gap: 10, flexGrow: 1 },
  bubble: { maxWidth: '78%', paddingVertical: 10, paddingHorizontal: 14, gap: 2 },
  mine: { alignSelf: 'flex-end', backgroundColor: c.royal, borderRadius: radius.lg, borderBottomRightRadius: 4 },
  theirs: { alignSelf: 'flex-start', backgroundColor: c.white, borderRadius: radius.lg, borderBottomLeftRadius: 4 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, paddingHorizontal: space.xl, paddingTop: space.md, backgroundColor: c.white, borderTopWidth: 1, borderTopColor: c.lavender },
  inputWrap: { flex: 1, minHeight: TOUCH, borderRadius: radius.xl, backgroundColor: c.cream, justifyContent: 'center', paddingHorizontal: space.lg },
  input: { fontSize: text.md + 1, color: c.ink, maxHeight: 120, paddingVertical: space.sm },
  send: { width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, backgroundColor: c.royal, alignItems: 'center', justifyContent: 'center' },
});
