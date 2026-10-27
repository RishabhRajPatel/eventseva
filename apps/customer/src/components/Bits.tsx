// Small presentational pieces shared by many screens.
import { memo, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { BookingStatus } from '@eventseva/app-shared';
import { useTranslation } from 'react-i18next';
import { STATUS_TONE, type StatusTone } from '../lib/booking';
import { c, radius, space } from '../lib/theme';
import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

export function Card({ children, style, onPress, label }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; label?: string }) {
  if (!onPress) return <View style={[styles.card, style]}>{children}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.card, style, pressed && styles.pressed]}
    >
      {children}
    </Pressable>
  );
}

const toneColors: Record<StatusTone, { bg: string; fg: string }> = {
  lavender: { bg: c.lavender, fg: c.royal },
  // Status pairs from UX.md §1 (waiting: peach / brown, success: mint / green).
  peach: { bg: c.peach, fg: c.warningText },
  mint: { bg: c.mint, fg: c.successText },
  ink: { bg: c.ink, fg: c.white },
  muted: { bg: '#ececf0', fg: c.ink },
};

export const Pill = memo(function Pill({ label, tone = 'lavender' }: { label: string; tone?: StatusTone }) {
  const t = toneColors[tone];
  return (
    <View style={[styles.pill, { backgroundColor: t.bg }]}>
      <AppText variant="bold" size="xs" color={t.fg} numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
});

export function StatusPill({ status }: { status: BookingStatus }) {
  const { t } = useTranslation();
  return <Pill label={t(`status.${status}.pill`)} tone={STATUS_TONE[status]} />;
}

export function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.sectionTitle}>
      <AppText variant="display" size="xl" accessibilityRole="header" style={styles.flex}>
        {title}
      </AppText>
      {action && onAction ? (
        <Pressable accessibilityRole="link" onPress={onAction} hitSlop={12} style={styles.action}>
          <AppText variant="bold" size="sm" color={c.royal}>
            {action}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

/** "Label ........ value" line in price boxes. */
export function MoneyRow({ label, value, strong, accent, small }: { label: string; value: string; strong?: boolean; accent?: boolean; small?: boolean }) {
  return (
    <View style={styles.moneyRow}>
      <AppText size={small ? 'sm' : 'md'} variant={strong ? 'bold' : 'body'} style={styles.flex}>
        {label}
      </AppText>
      <AppText variant="bold" size={small ? 'sm' : strong ? 'xl' : 'md'} color={accent ? c.royal : c.text}>
        {value}
      </AppText>
    </View>
  );
}

export const Divider = () => <View style={styles.divider} />;

const NOTICE_ICON = { lavender: c.royal, mint: c.successText, mintLight: c.successText, peach: c.warningText, danger: c.danger } as const;

/** Coloured info strip (mint success, lavender hint, peach warning). */
export function Notice({ icon, children, tone = 'lavender' }: { icon?: IconName; children: ReactNode; tone?: 'lavender' | 'mint' | 'mintLight' | 'peach' | 'danger' }) {
  const bg = { lavender: c.lavender, mint: c.mint, mintLight: c.mintLight, peach: c.peach, danger: c.dangerBg }[tone];
  return (
    <View style={[styles.notice, { backgroundColor: bg }]}>
      {icon ? <Icon name={icon} size={18} color={NOTICE_ICON[tone]} /> : null}
      <View style={styles.flex}>{typeof children === 'string' ? <AppText size="sm">{children}</AppText> : children}</View>
    </View>
  );
}

/** Settings-style row (Profile board). */
export function ListRow({ label, value, onPress, tone, last }: { label: string; value?: ReactNode; onPress: () => void; tone?: 'royal' | 'danger'; last?: boolean }) {
  const color = tone === 'royal' ? c.royal : tone === 'danger' ? c.danger : c.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.listRow, !last && styles.listRowBorder, pressed && styles.listRowPressed]}
    >
      <AppText size="lg" variant={tone ? 'bold' : 'body'} color={color} style={styles.flex}>
        {label}
      </AppText>
      {typeof value === 'string' ? <AppText size="sm">{value}</AppText> : value}
      <Icon name="forward" size={18} color={c.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { backgroundColor: c.white, borderRadius: radius.lg, padding: space.md },
  pill: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  sectionTitle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  action: { minHeight: 48, justifyContent: 'center' },
  moneyRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.md },
  divider: { height: 1, backgroundColor: c.lavender },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: radius.md, paddingVertical: space.md, paddingHorizontal: space.lg },
  listRow: { minHeight: 52, paddingHorizontal: space.lg, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  listRowBorder: { borderBottomWidth: 1, borderBottomColor: c.lavender },
  listRowPressed: { backgroundColor: c.cream },
  pressed: { opacity: 0.85 },
});
