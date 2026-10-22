import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { c, space } from '../lib/theme';
import { IconButton } from './Button';
import { Txt } from './Txt';

interface ScreenProps {
  children: ReactNode;
  /** Plain big title at the top (tab screens). */
  title?: string;
  /** Shows a back button with the title (stack screens). */
  back?: boolean;
  subtitle?: string;
  right?: ReactNode;
  /** Pinned under the scroll area (Submit / Save buttons). */
  footer?: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: StyleProp<ViewStyle>;
  /** Tab screens sit above the tab bar, which already handles the bottom inset. */
  inTabs?: boolean;
  testID?: string;
}

/** Cream page with safe areas, a header and a scrolling body; max width keeps tablets readable. */
export function Screen({ children, title, back, subtitle, right, footer, scroll = true, refreshing, onRefresh, contentStyle, inTabs, testID }: ScreenProps) {
  const insets = useSafeAreaInsets();
  const body = scroll ? (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[styles.content, contentStyle]}
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} colors={[c.royal]} tintColor={c.royal} /> : undefined}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.fill, contentStyle]}>{children}</View>
  );
  return (
    <KeyboardAvoidingView testID={testID} behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.page, { paddingTop: insets.top }]}>
      {title !== undefined || back ? <Header title={title} subtitle={subtitle} back={back} right={right} /> : null}
      {body}
      {footer ? <View style={[styles.footer, { paddingBottom: (inTabs ? 0 : insets.bottom) + space.lg }]}>{footer}</View> : null}
    </KeyboardAvoidingView>
  );
}

export function Header({ title, subtitle, back, right }: { title?: string; subtitle?: string; back?: boolean; right?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <View style={styles.header}>
      {back ? <IconButton icon="back" label={t('common.back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} /> : null}
      <View style={{ flex: 1 }}>
        {title ? (
          <Txt variant="display" size={back ? 'xxl' : 'display'} accessibilityRole="header" numberOfLines={2}>
            {title}
          </Txt>
        ) : null}
        {subtitle ? (
          <Txt size="sm" color={c.textMuted}>
            {subtitle}
          </Txt>
        ) : null}
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: c.cream },
  fill: { flex: 1 },
  content: { padding: space.xl, paddingTop: space.sm, gap: space.lg, paddingBottom: space.xxxl, width: '100%', maxWidth: 760, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.xl, paddingTop: space.lg, paddingBottom: space.md, width: '100%', maxWidth: 760, alignSelf: 'center' },
  footer: { paddingHorizontal: space.xl, paddingTop: space.md, gap: space.sm, backgroundColor: c.cream, width: '100%', maxWidth: 760, alignSelf: 'center' },
});
