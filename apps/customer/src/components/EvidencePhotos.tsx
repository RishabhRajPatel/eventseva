// Photos the vendor took at handover / return (or delivery): small tiles, tap to see one large.
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { cardImage, zoomImage } from '@eventseva/app-shared';
import { CLOUD_NAME } from '../lib/config';
import { c, radius, space } from '../lib/theme';
import { AppText } from './AppText';
import { Button } from './Button';

export function EvidencePhotos({ ids, label }: { ids: string[]; label: string }) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const [open, setOpen] = useState<string | null>(null);
  if (!ids.length || !CLOUD_NAME) return null;
  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {ids.map((id, i) => (
          <Pressable key={id} accessibilityRole="imagebutton" accessibilityLabel={t('photos.evidence', { label, n: i + 1, total: ids.length })} onPress={() => setOpen(id)}>
            <Image source={{ uri: cardImage(CLOUD_NAME, id, 96, 72) }} style={styles.tile} contentFit="cover" />
          </Pressable>
        ))}
      </ScrollView>
      <Modal visible={!!open} transparent animationType="fade" onRequestClose={() => setOpen(null)}>
        <View style={styles.backdrop}>
          {open ? <Image source={{ uri: zoomImage(CLOUD_NAME, open, width) }} style={{ width, height: width }} contentFit="contain" /> : null}
          <AppText size="sm" color={c.white}>{label}</AppText>
          <Button label={t('common.close')} variant="secondary" size="md" onPress={() => setOpen(null)} />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: space.sm, paddingVertical: space.xs },
  tile: { width: 96, height: 72, borderRadius: radius.md, backgroundColor: c.lavender },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.lg },
});
