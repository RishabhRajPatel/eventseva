import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { Media } from '@eventseva/app-shared';
import { streamUrl, wideUrl, thumbUrl } from '../lib/media';
import { c, space } from '../lib/theme';
import { Button, IconButton } from './Button';
import { Pill } from './Chip';
import { Icon } from './Icon';
import { clock } from './MediaGrid';
import { Txt } from './Txt';

const TONE = { pending: 'warning', approved: 'success', rejected: 'danger' } as const;

/** Full-screen view of one photo (or a video's poster), with its review status and the ⋯ options. */
export function MediaViewer({ media, list, onChange, onClose, onOptions }: { media: Media; list: Media[]; onChange: (m: Media) => void; onClose: () => void; onOptions?: (m: Media) => void }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const i = list.findIndex((m) => m.id === media.id);
  const url = media.type === 'video' ? thumbUrl(media, Math.min(width, 900), Math.round(Math.min(width, 900) * 0.5625)) : wideUrl(media, Math.min(width, 1200));
  const status = media.status ?? 'approved';
  const [playing, setPlaying] = useState(false);
  // Moving to another photo or video stops the one playing.
  useEffect(() => setPlaying(false), [media.id]);
  const stream = media.type === 'video' ? streamUrl(media) : null;
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.page, { paddingTop: insets.top + space.sm, paddingBottom: insets.bottom + space.lg }]} testID="media-viewer">
        <View style={styles.top}>
          <IconButton icon="close" label={t('common.close')} bg="rgba(255,255,255,0.12)" color={c.white} onPress={onClose} testID="viewer-close" />
          <Txt variant="bold" size="md" color={c.white} style={{ flex: 1 }} align="center">
            {list.length > 1 ? t('photos.position', { n: i + 1, total: list.length }) : ''}
          </Txt>
          {onOptions ? <IconButton icon="more" label={t('photos.options', { kind: t(media.type === 'video' ? 'photos.video' : 'photos.photo') })} bg="rgba(255,255,255,0.12)" color={c.white} onPress={() => onOptions(media)} testID="viewer-options" /> : <View style={{ width: 48 }} />}
        </View>
        <View style={styles.stage}>
          {url ? (
            <Image
              source={{ uri: url }}
              style={StyleSheet.absoluteFill}
              contentFit="contain"
              cachePolicy="memory-disk"
              recyclingKey={media.id}
              transition={150}
              placeholder={media.blurhash ? { blurhash: media.blurhash } : undefined}
            />
          ) : (
            <Icon name="image" size={48} color={c.lilac} strokeWidth={1.5} />
          )}
          {playing && stream ? (
            <InlineVideo key={media.id} uri={stream} />
          ) : media.type === 'video' ? (
            <Pressable
              testID="viewer-play"
              accessibilityRole="button"
              accessibilityLabel={t('photos.playVideo')}
              disabled={!stream}
              onPress={() => setPlaying(true)}
              style={({ pressed }) => [styles.play, pressed && { opacity: 0.85 }]}
            >
              <Icon name="play" size={28} color={c.white} />
            </Pressable>
          ) : null}
          {i > 0 ? (
            <View style={[styles.nav, { left: space.sm }]}>
              <IconButton icon="back" label={t('photos.previous')} bg="rgba(35,38,47,0.6)" color={c.white} onPress={() => onChange(list[i - 1])} />
            </View>
          ) : null}
          {i >= 0 && i < list.length - 1 ? (
            <View style={[styles.nav, { right: space.sm }]}>
              <IconButton icon="next" label={t('photos.next')} bg="rgba(35,38,47,0.6)" color={c.white} onPress={() => onChange(list[i + 1])} />
            </View>
          ) : null}
        </View>
        <View style={styles.info}>
          <View style={styles.row}>
            <Pill label={t(`photos.status.${status}`)} tone={TONE[status]} />
            {media.isCover ? <Pill label={t('photos.cover')} tone="info" /> : null}
            {media.type === 'video' && media.durationSec ? (
              <Txt size="sm" color={c.white}>
                {clock(media.durationSec)}
              </Txt>
            ) : null}
          </View>
          <Txt size="sm" color={c.white} style={{ lineHeight: 20 }}>
            {status === 'rejected' ? media.rejectReason || t('photos.rejectedNoReason') : t(`photos.statusNote.${status}`)}
          </Txt>
          {media.type === 'video' ? (
            <Txt size="xs" color={c.lavender}>
              {t('photos.videoPreviewNote')}
            </Txt>
          ) : null}
          {onOptions ? <Button kind="secondary" icon="more" label={t('photos.optionsButton')} onPress={() => onOptions(media)} /> : null}
        </View>
      </View>
    </Modal>
  );
}

/** Loads the video only when play is tapped (adaptive HLS from Cloudinary). */
function InlineVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
    p.play();
  });
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls testID="viewer-video" />;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: c.toast, gap: space.md },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  play: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(35,38,47,0.6)', alignItems: 'center', justifyContent: 'center' },
  nav: { position: 'absolute', top: '50%', marginTop: -24 },
  info: { paddingHorizontal: space.xl, gap: space.sm, width: '100%', maxWidth: 640, alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
});
