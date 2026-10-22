import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import type { Media } from '@eventseva/app-shared';
import { thumbUrl } from '../lib/media';
import { c, radius } from '../lib/theme';
import { Icon } from './Icon';
import { Txt } from './Txt';

/** Square thumbnails with review badges, plus a dashed "add" tile. */
export function MediaGrid({
  media,
  columns = 5,
  onAdd,
  adding,
  canAdd = true,
  onPressItem,
}: {
  media: Media[];
  columns?: number;
  onAdd?: () => void;
  adding?: boolean;
  canAdd?: boolean;
  onPressItem?: (m: Media) => void;
}) {
  const { t } = useTranslation();
  const width = `${100 / columns}%` as const;
  return (
    <View style={styles.grid}>
      {media.map((m) => (
        <Pressable key={m.id} testID={`media-${m.id}`} disabled={!onPressItem} onPress={() => onPressItem?.(m)} style={[styles.cell, { width }]}>
          <MediaTile media={m} />
        </Pressable>
      ))}
      {onAdd && canAdd ? (
        <View style={[styles.cell, { width }]}>
          <Pressable testID="add-photo" accessibilityRole="button" accessibilityLabel={t('photos.add')} onPress={onAdd} style={[styles.tile, styles.add]}>
            {adding ? <ActivityIndicator color={c.royal} /> : <Icon name="plus" size={20} color={c.royal} />}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function MediaTile({ media }: { media: Media }) {
  const { t } = useTranslation();
  const url = thumbUrl(media, 120, 120);
  return (
    <View style={[styles.tile, { backgroundColor: c.lilac }]} accessibilityLabel={t(`photos.status.${media.status ?? 'approved'}`)}>
      {url ? <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" placeholder={media.blurhash ? { blurhash: media.blurhash } : undefined} /> : <Icon name={media.type === 'video' ? 'camera' : 'image'} size={20} color={c.royal} />}
      {media.status === 'pending' ? (
        <View style={[styles.overlay, { backgroundColor: 'rgba(255,214,165,0.92)' }]}>
          <Txt variant="bold" size="xs" align="center">
            {t('photos.status.pending')}
          </Txt>
        </View>
      ) : media.status === 'rejected' ? (
        <View style={[styles.overlay, { backgroundColor: 'rgba(253,232,231,0.94)' }]}>
          <Txt variant="bold" size="xs" align="center" color={c.danger}>
            {t('photos.status.rejected')}
          </Txt>
        </View>
      ) : null}
      {media.isCover ? (
        <View style={styles.cover}>
          <Txt variant="bold" size="xs">
            {t('photos.cover')}
          </Txt>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -3 },
  cell: { padding: 3 },
  tile: { aspectRatio: 1, borderRadius: radius.sm, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  add: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.royal, backgroundColor: c.white },
  overlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', padding: 2 },
  cover: { position: 'absolute', left: 4, bottom: 4, backgroundColor: c.white, borderRadius: 4, paddingHorizontal: 4 },
});
