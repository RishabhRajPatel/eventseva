import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { rupees, type Booking } from '@eventseva/app-shared';
import { c, radius, space } from '../lib/theme';
import { AppText } from './AppText';
import { StatusPill } from './Bits';
import { Button } from './Button';
import { categoryIcon, Icon } from './Icon';

/** A booking in My Events (Bookings board): service, vendor · state, status pill, Pay button when due. */
export const BookingRow = memo(function BookingRow({ booking: b }: { booking: Booking }) {
  const { t } = useTranslation();
  const open = useCallback(() => router.push({ pathname: '/booking/[id]', params: { id: b.id } }), [b.id]);
  const pay = useCallback(() => router.push({ pathname: '/pay/[id]', params: { id: b.id } }), [b.id]);
  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${b.item.title}, ${b.vendor.businessName}, ${t(`status.${b.status}.pill`)}`}
        onPress={open}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <View style={styles.avatar}>
          <Icon name={categoryIcon(b.vendor.categoryIcon)} size={22} color={c.royal} />
        </View>
        <View style={styles.text}>
          <AppText variant="bold" size="md" numberOfLines={1}>
            {b.item.title}
          </AppText>
          <AppText size="xs" numberOfLines={1}>
            {`${b.vendor.businessName} · ${t(`status.${b.status}.short`)}`}
          </AppText>
        </View>
        <StatusPill status={b.status} />
      </Pressable>
      {b.status === 'accepted' ? <Button size="md" label={t('bookings.payAdvance', { amount: rupees(b.payNowPaise) })} onPress={pay} /> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  card: { backgroundColor: c.white, borderRadius: radius.lg, padding: 14, gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48 },
  pressed: { opacity: 0.85 },
  avatar: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: c.lavender, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 3 },
});
