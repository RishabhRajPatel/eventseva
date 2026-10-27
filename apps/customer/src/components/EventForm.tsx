import type { Ref } from 'react';
import { ScrollView, StyleSheet, View, type TextInputInstance } from 'react-native';
import { useTranslation } from 'react-i18next';
import { EVENT_TYPES } from '@eventseva/app-shared';
import type { EventDraft, EventErrors } from '../lib/events';
import { space } from '../lib/theme';
import { AppText } from './AppText';
import { DatePicker } from './DatePicker';
import { Chip, FieldError, TextField } from './Form';

export type EventField = keyof EventErrors;

/** Fields for a new event: name, type, date, guests, venue (used inline in the booking form too). */
export function EventForm({
  value,
  onChange,
  errors,
  busy,
  onBlurField,
  refs,
}: {
  value: EventDraft;
  onChange: (d: EventDraft) => void;
  errors: EventErrors;
  /** Vendor's busy days, when creating the event while booking a vendor. */
  busy?: Record<string, 'full' | 'partial'>;
  /** Validate one field as the user leaves it (UX.md §3). */
  onBlurField?: (field: EventField) => void;
  /** So a failed submit can focus the first wrong field. */
  refs?: Partial<Record<'title' | 'guests' | 'venue', Ref<TextInputInstance>>>;
}) {
  const { t } = useTranslation();
  const set = (patch: Partial<EventDraft>) => onChange({ ...value, ...patch });
  return (
    <View style={styles.wrap}>
      <TextField
        ref={refs?.title}
        label={t('event.name')}
        placeholder={t('event.namePlaceholder')}
        value={value.title}
        onChangeText={(title) => set({ title })}
        onBlur={() => onBlurField?.('title')}
        maxLength={80}
        returnKeyType="next"
        error={errors.title ? t(`event.errors.${errors.title}`) : null}
      />
      <View style={styles.gap8}>
        <AppText variant="bold" size="sm">
          {t('event.type')}
        </AppText>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityRole="radiogroup">
          {EVENT_TYPES.map((type) => (
            <Chip key={type} label={t(`eventTypes.${type}`)} selected={value.eventType === type} onPress={() => set({ eventType: type })} />
          ))}
        </ScrollView>
      </View>
      <View style={styles.gap8}>
        <AppText variant="bold" size="sm">
          {t('event.date')}
        </AppText>
        <DatePicker
          value={value.eventDate}
          onChange={(eventDate) => set({ eventDate })}
          busy={busy}
        />
        <FieldError>{errors.eventDate ? t(`event.errors.${errors.eventDate}`) : null}</FieldError>
      </View>
      <View style={styles.pair}>
        <View style={styles.flex}>
          <TextField
            ref={refs?.guests}
            label={t('event.guests')}
            placeholder="300"
            value={value.guests}
            onChangeText={(guests) => set({ guests: guests.replace(/\D/g, '') })}
            onBlur={() => onBlurField?.('guests')}
            keyboardType="number-pad"
            maxLength={6}
            error={errors.guests ? t(`event.errors.${errors.guests}`) : null}
          />
        </View>
        <View style={styles.flex}>
          <TextField
            ref={refs?.venue}
            label={t('event.venue')}
            placeholder={t('event.venuePlaceholder')}
            value={value.venue}
            onChangeText={(venue) => set({ venue })}
            onBlur={() => onBlurField?.('venue')}
            maxLength={300}
            error={errors.venue ? t(`event.errors.${errors.venue}`) : null}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.lg },
  gap8: { gap: space.sm },
  chips: { gap: space.sm },
  pair: { flexDirection: 'row', gap: space.md },
  flex: { flex: 1 },
});
