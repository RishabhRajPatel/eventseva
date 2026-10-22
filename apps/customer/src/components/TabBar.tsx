// Bottom tab bar (Home board) on phones; side rail with the "E" mark (TabletHome board) on wide tablets.
import { Pressable, StyleSheet, View } from 'react-native';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { keys } from '../lib/queryClient';
import { c, fonts, radius, space } from '../lib/theme';
import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

export const TABS = [
  { name: 'index', icon: 'home', label: 'tabs.home' },
  { name: 'bookings', icon: 'calendar', label: 'tabs.events' },
  { name: 'chat', icon: 'chat', label: 'tabs.chat' },
  { name: 'profile', icon: 'user', label: 'tabs.profile' },
] as const satisfies readonly { name: string; icon: IconName; label: string }[];

/** Screens inside the tabs group that belong to a tab without being one. */
const OWNER: Record<string, string> = { search: 'index' };

export function TabBar({ state, emitter, navigateToTab, insets, rail }: BottomTabBarProps & { rail: boolean }) {
  const { t } = useTranslation();
  const current = state.routes[state.index]?.name;
  const active = OWNER[current] ?? current;
  const unreadChats = useQuery({ queryKey: keys.conversations, queryFn: api.conversations, staleTime: 60_000 });
  const chatBadge = (unreadChats.data?.items ?? []).reduce((n, cv) => n + cv.unreadCount, 0);

  const items = TABS.map((tab) => {
    const route = state.routes.find((r) => r.name === tab.name);
    if (!route) return null;
    const focused = active === tab.name;
    const color = focused ? c.royal : c.ink;
    const onPress = () => {
      const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
      if (current !== tab.name && !event.defaultPrevented) navigateToTab(route.key);
    };
    const badge = tab.name === 'chat' && chatBadge > 0 ? chatBadge : 0;
    return (
      <Pressable
        key={tab.name}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={badge ? `${t(tab.label)}, ${t('chat.unread', { count: badge })}` : t(tab.label)}
        onPress={onPress}
        style={[rail ? styles.railItem : styles.item, rail && focused && styles.railItemOn]}
      >
        <View>
          <Icon name={tab.icon} size={rail ? 24 : 22} color={color} />
          {badge ? <View style={styles.dot} /> : null}
        </View>
        <AppText variant={focused ? 'bold' : 'body'} size={rail ? 13 : 'xs'} color={color} numberOfLines={1}>
          {t(tab.label)}
        </AppText>
      </Pressable>
    );
  });

  if (rail) {
    return (
      <View style={[styles.rail, { paddingTop: insets.top + space.xxl, paddingLeft: insets.left }]} role="tablist">
        <View style={styles.mark}>
          <AppText size={28} color={c.white} style={{ fontFamily: fonts.en.display }}>
            E
          </AppText>
        </View>
        {items}
      </View>
    );
  }
  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom }]} role="tablist">
      {items}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', backgroundColor: c.white, borderTopWidth: 1, borderTopColor: c.lavender },
  item: { flex: 1, minHeight: 68, alignItems: 'center', justifyContent: 'center', gap: space.xs },
  rail: { width: 96, backgroundColor: c.white, borderRightWidth: 1, borderRightColor: c.lavender, alignItems: 'center', gap: space.md },
  mark: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: c.royal, alignItems: 'center', justifyContent: 'center', marginBottom: space.lg },
  railItem: { width: 72, minHeight: 64, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', gap: space.xs },
  railItemOn: { backgroundColor: c.lavender },
  dot: { position: 'absolute', top: -2, right: -4, width: 10, height: 10, borderRadius: 5, backgroundColor: c.danger },
});
