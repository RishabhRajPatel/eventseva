import Tabs from 'expo-router/js-tabs';
import { useLayout } from '../../hooks/useLayout';
import { c } from '../../lib/theme';
import { TabBar } from '../../components/TabBar';

export default function TabsLayout() {
  const { hasRail } = useLayout();
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} rail={hasRail} />}
      screenOptions={{ headerShown: false, tabBarPosition: hasRail ? 'left' : 'bottom', sceneStyle: { backgroundColor: c.background } }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="bookings" />
      <Tabs.Screen name="chat" />
      <Tabs.Screen name="profile" />
      <Tabs.Screen name="search" options={{ href: null }} />
    </Tabs>
  );
}
