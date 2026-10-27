import type { ReactNode, Ref } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type ScrollViewInstance, type StyleProp, type ViewStyle } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useLayout } from '../hooks/useLayout';
import { c, space } from '../lib/theme';
import { AppText } from './AppText';
import { IconButton } from './Button';

/** Cream page with safe-area padding. `scroll` wraps the content in a ScrollView. */
export function Screen({
  children,
  scroll,
  footer,
  edges = ['top', 'left', 'right'],
  background = c.background,
  contentStyle,
  keyboard,
  scrollRef,
}: {
  children: ReactNode;
  /** With `scroll`: lets a form scroll to its first error. */
  scrollRef?: Ref<ScrollViewInstance>;
  scroll?: boolean;
  /** Pinned action bar at the bottom (white, top border), as on the booking boards. */
  footer?: ReactNode;
  edges?: Edge[];
  background?: string;
  contentStyle?: StyleProp<ViewStyle>;
  /** Push content up when the keyboard opens (forms). */
  keyboard?: boolean;
}) {
  const { gutter, isTablet } = useLayout();
  const inner = [{ paddingHorizontal: gutter }, isTablet && styles.tabletWidth, contentStyle];
  const body = scroll ? (
    <ScrollView ref={scrollRef} contentContainerStyle={[styles.scrollContent, ...inner]} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, ...inner]}>{children}</View>
  );
  const content = (
    <>
      {body}
      {footer ? <SafeAreaView edges={['bottom']} style={[styles.footer, { paddingHorizontal: gutter }]}>{footer}</SafeAreaView> : null}
    </>
  );
  return (
    <SafeAreaView edges={edges} style={[styles.flex, { backgroundColor: background }]}>
      {keyboard ? (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {content}
        </KeyboardAvoidingView>
      ) : (
        content
      )}
    </SafeAreaView>
  );
}

/** Back button + title row used by inner pages (BookingForm, Payment, Language boards). */
export function ScreenHeader({
  title,
  subtitle,
  right,
  onBack,
  backTone = 'white',
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onBack?: () => void;
  backTone?: 'white' | 'lavender';
}) {
  const { t } = useTranslation();
  const back = onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/')));
  return (
    <View style={styles.header}>
      <IconButton icon="back" label={t('common.back')} onPress={back} tone={backTone} iconColor={backTone === 'lavender' ? c.royal : c.ink} />
      <View style={styles.flex}>
        <AppText variant="display" size="xxl" accessibilityRole="header" numberOfLines={2}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText size="sm" numberOfLines={2}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrollContent: { paddingBottom: space.xxxl, gap: space.lg },
  tabletWidth: { width: '100%', maxWidth: 760, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingTop: space.xxl, paddingBottom: space.md },
  footer: { backgroundColor: c.white, borderTopWidth: 1, borderTopColor: c.lavender, paddingTop: space.md, paddingBottom: space.lg, gap: space.sm },
});
