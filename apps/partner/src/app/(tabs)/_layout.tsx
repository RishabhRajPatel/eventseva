import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { View } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useDashboard, useVendor } from '../../lib/queries';
import { routeFor } from '../../lib/routing';
import { useSession } from '../../lib/session';
import { c, text } from '../../lib/theme';
import { OnHoldBanner } from '../../components/Banners';
import { Icon, type IconName } from '../../components/Icon';
import { useFonts } from '../../components/Txt';

const TABS: Array<{ name: string; label: string; icon: IconName }> = [
  { name: 'home', label: 'tabs.home', icon: 'dashboard' },
  { name: 'bookings', label: 'tabs.bookings', icon: 'bookings' },
  { name: 'calendar', label: 'tabs.calendar', icon: 'calendar' },
  { name: 'chat', label: 'tabs.chat', icon: 'chat' },
  { name: 'profile', label: 'tabs.profile', icon: 'profile' },
];

/** The five tabs from the VendorDash board, for approved (and on-hold) vendors. */
export default function TabsLayout() {
  const { t } = useTranslation();
  const f = useFonts();
  const insets = useSafeAreaInsets();
  const { me } = useSession();
  const vendor = useVendor();
  const dashboard = useDashboard();

  // The status can change while the app is open (put on hold, …): follow it.
  const status = vendor.data === undefined ? undefined : vendor.data?.status ?? null;
  if (status !== undefined) {
    const target = routeFor({ name: me?.name ?? 'x', vendorStatus: status });
    if (target !== '/home') return <Redirect href={target} />;
  }

  const badges: Record<string, number | undefined> = {
    bookings: dashboard.data?.newRequests || undefined,
    chat: dashboard.data?.unreadChats || undefined,
  };

  const onHold = status === 'on_hold';
  return (
    <View style={{ flex: 1, backgroundColor: c.cream }}>
      {onHold ? (
        <View style={{ paddingTop: insets.top, backgroundColor: c.peach }}>
          <OnHoldBanner />
        </View>
      ) : null}
      {/* With the banner on top, the screens below no longer need the status-bar inset. */}
      <SafeAreaInsetsContext.Provider value={onHold ? { ...insets, top: 0 } : insets}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: c.royal,
          tabBarInactiveTintColor: c.ink,
          tabBarStyle: { backgroundColor: c.white, borderTopColor: c.lavender, height: 68 + insets.bottom, paddingTop: 6 },
          tabBarLabelStyle: { fontFamily: f.bodyBold, fontSize: text.xs },
          tabBarBadgeStyle: { backgroundColor: c.danger, color: c.white, fontSize: 11 },
          sceneStyle: { backgroundColor: c.cream },
        }}
      >
        {TABS.map((tab) => (
          <Tabs.Screen
            key={tab.name}
            name={tab.name}
            options={{
              title: t(tab.label),
              tabBarBadge: badges[tab.name],
              tabBarButtonTestID: `tab-${tab.name}`,
              tabBarIcon: ({ color }) => <Icon name={tab.icon} size={22} color={color as string} />,
            }}
          />
        ))}
      </Tabs>
      </SafeAreaInsetsContext.Provider>
    </View>
  );
}
