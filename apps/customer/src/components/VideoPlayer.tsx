// Vendor videos: poster tiles on the vendor page, and a full-screen player (adaptive HLS from
// Cloudinary, so it starts fast on 4G and gets sharper on Wi-Fi).
import { memo } from 'react';
import { FlatList, Modal, PixelRatio, Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { videoPoster, videoStream, type Media } from '@eventseva/app-shared';
import { CLOUD_NAME } from '../lib/config';
import { c, radius, space } from '../lib/theme';
import { AppText } from './AppText';
import { IconButton } from './Button';
import { Icon } from './Icon';

/** "1:05" */
export const duration = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

const TILE_W = 200;
const TILE_H = 112;

export const VideoTiles = memo(function VideoTiles({ videos, onOpen }: { videos: Media[]; onOpen: (m: Media) => void }) {
  const { t } = useTranslation();
  return (
    <FlatList
      horizontal
      data={videos}
      keyExtractor={(m) => m.id}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      renderItem={({ item, index }) => (
        <Pressable
          testID={`video-${item.id}`}
          accessibilityRole="button"
          accessibilityLabel={t('vendor.playVideo', { n: index + 1, total: videos.length })}
          onPress={() => onOpen(item)}
          style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
        >
          {CLOUD_NAME ? (
            <Image
              source={{ uri: videoPoster(CLOUD_NAME, item.publicId, TILE_W, PixelRatio.get()) }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              cachePolicy="memory-disk"
              recyclingKey={item.id}
            />
          ) : null}
          <View style={styles.play}>
            <Icon name="play" size={22} color={c.white} />
          </View>
          {item.durationSec ? (
            <View style={styles.badge}>
              <AppText size="xs" variant="bold" color={c.white}>
                {duration(item.durationSec)}
              </AppText>
            </View>
          ) : null}
        </Pressable>
      )}
    />
  );
});

/** Full-screen player. The video only loads once this opens, so the vendor page stays light. */
export function VideoModal({ media, onClose }: { media: Media; onClose: () => void }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const player = useVideoPlayer(CLOUD_NAME ? videoStream(CLOUD_NAME, media.publicId) : null, (p) => {
    p.loop = false;
    p.play();
  });
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent supportedOrientations={['portrait', 'landscape']}>
      <View style={[styles.page, { paddingTop: insets.top + space.sm, paddingBottom: insets.bottom }]} testID="video-modal">
        <View style={styles.top}>
          <IconButton icon="close" label={t('common.close')} onPress={onClose} />
        </View>
        <VideoView player={player} style={styles.video} contentFit="contain" nativeControls />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  row: { gap: space.sm },
  tile: { width: TILE_W, height: TILE_H, borderRadius: radius.md, overflow: 'hidden', backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.85 },
  play: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(35,38,47,0.65)', alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', right: 6, bottom: 6, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: 'rgba(35,38,47,0.75)' },
  page: { flex: 1, backgroundColor: '#000' },
  top: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: space.lg },
  video: { flex: 1 },
});
