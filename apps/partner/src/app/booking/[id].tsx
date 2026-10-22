import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useBooking } from '../../lib/queries';
import { useNow } from '../../hooks/useNow';
import { BookingDetail } from '../../components/BookingDetail';
import { Screen } from '../../components/Screen';
import { QueryView } from '../../components/States';

export default function BookingScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const booking = useBooking(id);
  const now = useNow();
  return (
    <Screen back title={t('booking.title')} refreshing={booking.isRefetching} onRefresh={() => void booking.refetch()}>
      <QueryView query={booking}>{(b) => <BookingDetail booking={b} now={now} />}</QueryView>
    </Screen>
  );
}
