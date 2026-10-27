import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import type { Media } from '@eventseva/app-shared';
import { errorText } from '../lib/errors';
import { thumbUrl } from '../lib/media';
import { c, radius, space } from '../lib/theme';
import type { UploadItem } from '../lib/uploadQueue';
import { LinkButton } from './Button';
import { TONES, Tick, type Tone } from './Chip';
import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';

const STATUS: Record<NonNullable<Media['status']>, { tone: Tone; icon: IconName }> = {
  pending: { tone: 'warning', icon: 'clock' },
  approved: { tone: 'success', icon: 'check' },
  rejected: { tone: 'danger', icon: 'alert' },
};

/** "0:42" */
export const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

/**
 * Square thumbnails with review badges, the files still uploading (with progress, cancel and retry),
 * and a dashed "add" tile. `compact` is for small previews (Profile, onboarding): icon-only badges.
 */
export function MediaGrid({
  media,
  uploads = [],
  columns = 5,
  onAdd,
  canAdd = true,
  onOpen,
  onMore,
  selectedId,
  compact,
  onCancelUpload,
  onRetryUpload,
  onDismissUpload,
}: {
  media: Media[];
  uploads?: UploadItem[];
  columns?: number;
  onAdd?: () => void;
  canAdd?: boolean;
  onOpen?: (m: Media) => void;
  onMore?: (m: Media) => void;
  selectedId?: string | null;
  compact?: boolean;
  onCancelUpload?: (id: string) => void;
  onRetryUpload?: (id: string) => void;
  onDismissUpload?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const width = `${100 / columns}%` as const;
  const ids = new Set(media.map((m) => m.id));
  // A finished upload makes way for the real tile as soon as the list has it.
  const tiles = uploads.filter((u) => !(u.state === 'done' && u.media && ids.has(u.media.id)));
  const failed = uploads.filter((u) => u.state === 'failed');
  return (
    <View style={{ gap: space.sm }}>
      <View style={styles.grid}>
        {media.map((m) => (
          <View key={m.id} style={[styles.cell, { width }]}>
            <MediaTile media={m} compact={compact} selected={selectedId === m.id} onOpen={onOpen} onMore={onMore} />
          </View>
        ))}
        {tiles.map((u) => (
          <View key={u.id} style={[styles.cell, { width }]}>
            <UploadTile item={u} compact={compact} onCancel={onCancelUpload} onRetry={onRetryUpload} onDismiss={onDismissUpload} />
          </View>
        ))}
        {onAdd && canAdd ? (
          <View style={[styles.cell, { width }]}>
            <Pressable
              testID="add-photo"
              accessibilityRole="button"
              accessibilityLabel={t('photos.add')}
              onPress={onAdd}
              style={({ pressed }) => [styles.tile, styles.add, { opacity: pressed ? 0.85 : 1 }]}
            >
              <Icon name="plus" size={22} color={c.royal} />
              {!compact ? (
                <Txt variant="bold" size="xs" color={c.royal}>
                  {t('common.add')}
                </Txt>
              ) : null}
            </Pressable>
          </View>
        ) : null}
      </View>
      {failed.length ? (
        <View style={styles.failures} testID="upload-failures" accessibilityLiveRegion="polite">
          {failed.map((u, i) => (
            <View key={u.id} style={[styles.failure, i ? styles.failureBorder : null]} testID={`upload-failure-${u.id}`}>
              <Icon name="alert" size={16} color={c.onDanger} />
              <Txt size="sm" color={c.onDanger} style={{ flex: 1, lineHeight: 19 }}>
                {`${u.file.fileName ?? t(u.file.type === 'video' ? 'photos.video' : 'photos.photo')}: ${errorText(t, u.error)}`}
              </Txt>
              {u.retryable && onRetryUpload ? <LinkButton testID={`retry-${u.id}`} label={t('upload.retry')} onPress={() => onRetryUpload(u.id)} /> : null}
              {onDismissUpload ? <LinkButton label={t('upload.remove')} color={c.ink} onPress={() => onDismissUpload(u.id)} /> : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export const MediaTile = memo(function MediaTile({
  media,
  compact,
  selected,
  onOpen,
  onMore,
}: {
  media: Media;
  compact?: boolean;
  selected?: boolean;
  onOpen?: (m: Media) => void;
  onMore?: (m: Media) => void;
}) {
  const { t } = useTranslation();
  const url = thumbUrl(media, 160, 160);
  const status = STATUS[media.status ?? 'approved'];
  const statusLabel = t(`photos.status.${media.status ?? 'approved'}`);
  const kind = t(media.type === 'video' ? 'photos.video' : 'photos.photo');
  const tone = TONES[status.tone];
  return (
    <Pressable
      testID={`media-${media.id}`}
      disabled={!onOpen}
      onPress={() => onOpen?.(media)}
      onLongPress={onMore ? () => onMore(media) : undefined}
      accessibilityRole={onOpen ? 'imagebutton' : 'image'}
      accessibilityLabel={[kind, media.isCover ? t('photos.cover') : null, statusLabel].filter(Boolean).join(', ')}
      accessibilityState={{ selected: !!selected }}
      style={({ pressed }) => [styles.tile, { backgroundColor: c.lilac, opacity: pressed ? 0.85 : 1 }, selected ? styles.selected : null]}
    >
      {url ? (
        <Image
          source={{ uri: url }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={media.id}
          transition={150}
          placeholder={media.blurhash ? { blurhash: media.blurhash } : undefined}
        />
      ) : (
        <Icon name={media.type === 'video' ? 'camera' : 'image'} size={22} color={c.royal} />
      )}
      {media.type === 'video' ? (
        <View style={[styles.corner, styles.videoChip]}>
          <Icon name="play" size={12} color={c.white} />
          {!compact && media.durationSec ? (
            <Txt variant="bold" size="xs" color={c.white}>
              {clock(media.durationSec)}
            </Txt>
          ) : null}
        </View>
      ) : media.isCover ? (
        <View style={[styles.corner, styles.coverChip]} testID={`cover-badge-${media.id}`}>
          <Icon name="star" size={12} color={c.royal} />
          {!compact ? (
            <Txt variant="bold" size="xs" color={c.royal}>
              {t('photos.cover')}
            </Txt>
          ) : null}
        </View>
      ) : null}
      {compact ? (
        <View style={[styles.dot, { backgroundColor: tone.bg }]}>
          <Icon name={status.icon} size={11} strokeWidth={2.8} color={tone.fg} />
        </View>
      ) : (
        <View style={[styles.badge, { backgroundColor: tone.bg }]} testID={`status-${media.id}`}>
          <Txt variant="bold" size="xs" color={tone.fg} numberOfLines={2} align="center">
            {statusLabel}
          </Txt>
        </View>
      )}
      {selected ? (
        <View style={styles.topRight}>
          <Tick size={22} />
        </View>
      ) : onMore ? (
        <Pressable
          testID={`more-${media.id}`}
          accessibilityRole="button"
          accessibilityLabel={t('photos.options', { kind })}
          hitSlop={8}
          onPress={() => onMore(media)}
          style={({ pressed }) => [styles.topRight, styles.more, { opacity: pressed ? 0.8 : 1 }]}
        >
          <Icon name="more" size={18} color={c.white} />
        </Pressable>
      ) : null}
    </Pressable>
  );
});

/** A file on its way: thumbnail at once, then waiting / 45% / ✓ / failed ⟳. */
export const UploadTile = memo(function UploadTile({
  item,
  compact,
  onCancel,
  onRetry,
  onDismiss,
}: {
  item: UploadItem;
  compact?: boolean;
  onCancel?: (id: string) => void;
  onRetry?: (id: string) => void;
  onDismiss?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const pct = Math.round(item.progress * 100);
  const running = item.state === 'waiting' || item.state === 'uploading';
  const label =
    item.state === 'waiting'
      ? t('upload.waiting')
      : item.state === 'uploading'
        ? item.stage === 'preparing'
          ? t('upload.preparing')
          : item.stage === 'saving'
            ? t('upload.saving')
            : `${pct}%`
        : item.state === 'done'
          ? t('upload.done')
          : t('upload.failed');
  return (
    <View
      testID={`upload-${item.id}`}
      style={[styles.tile, { backgroundColor: c.lilac }]}
      accessibilityLabel={`${t(item.file.type === 'video' ? 'photos.video' : 'photos.photo')}: ${label}`}
      accessibilityRole={item.state === 'uploading' ? 'progressbar' : undefined}
      accessibilityValue={item.state === 'uploading' ? { min: 0, max: 100, now: pct } : undefined}
    >
      {item.file.type === 'photo' ? (
        <Image source={{ uri: item.file.uri }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={item.id} cachePolicy="memory" />
      ) : (
        <Icon name="play" size={24} color={c.royal} />
      )}
      {item.state === 'failed' ? (
        <View style={[styles.overlay, { backgroundColor: 'rgba(253,232,231,0.94)' }]}>
          <Icon name="alert" size={18} color={c.onDanger} />
          {!compact ? (
            <Txt variant="bold" size="xs" color={c.onDanger}>
              {label}
            </Txt>
          ) : null}
          {item.retryable && onRetry ? (
            <Pressable testID={`tile-retry-${item.id}`} accessibilityRole="button" accessibilityLabel={t('upload.retry')} hitSlop={8} onPress={() => onRetry(item.id)} style={styles.retry}>
              <Icon name="retry" size={16} color={c.white} />
            </Pressable>
          ) : null}
        </View>
      ) : item.state === 'done' ? (
        <View style={[styles.overlay, { backgroundColor: 'rgba(11,92,54,0.35)' }]}>
          <View style={styles.doneTick}>
            <Icon name="check" size={18} strokeWidth={3} color={c.onSuccess} />
          </View>
        </View>
      ) : (
        <View style={[styles.overlay, { backgroundColor: 'rgba(35,38,47,0.55)' }]}>
          <Txt variant="bold" size={item.stage === 'uploading' ? 'lg' : 'xs'} color={c.white} align="center">
            {label}
          </Txt>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${item.state === 'uploading' && item.stage === 'uploading' ? pct : item.stage === 'saving' ? 100 : 0}%` }]} />
          </View>
        </View>
      )}
      {(running && onCancel) || (item.state === 'failed' && onDismiss) ? (
        <Pressable
          testID={running ? `cancel-${item.id}` : `dismiss-${item.id}`}
          accessibilityRole="button"
          accessibilityLabel={running ? t('upload.cancel') : t('upload.remove')}
          hitSlop={8}
          onPress={() => (running ? onCancel?.(item.id) : onDismiss?.(item.id))}
          style={[styles.topRight, styles.more]}
        >
          <Icon name="close" size={14} strokeWidth={2.6} color={c.white} />
        </Pressable>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -3 },
  cell: { padding: 3 },
  tile: { aspectRatio: 1, borderRadius: radius.sm, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  selected: { borderWidth: 3, borderColor: c.royal },
  add: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.royal, backgroundColor: c.white, gap: 2 },
  overlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', padding: 4, gap: 4 },
  corner: { position: 'absolute', left: 4, top: 4, flexDirection: 'row', alignItems: 'center', gap: 2, borderRadius: 6, paddingHorizontal: 4, paddingVertical: 2 },
  coverChip: { backgroundColor: c.white },
  videoChip: { backgroundColor: 'rgba(35,38,47,0.75)' },
  badge: { position: 'absolute', left: 4, right: 4, bottom: 4, borderRadius: 6, paddingHorizontal: 4, paddingVertical: 2 },
  dot: { position: 'absolute', right: 3, bottom: 3, width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  topRight: { position: 'absolute', top: 4, right: 4 },
  more: { width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(35,38,47,0.65)', alignItems: 'center', justifyContent: 'center' },
  track: { position: 'absolute', left: 6, right: 6, bottom: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.35)', overflow: 'hidden' },
  fill: { height: 6, backgroundColor: c.mint },
  doneTick: { width: 32, height: 32, borderRadius: 16, backgroundColor: c.mint, alignItems: 'center', justifyContent: 'center' },
  retry: { width: 32, height: 32, borderRadius: 16, backgroundColor: c.royal, alignItems: 'center', justifyContent: 'center' },
  failures: { backgroundColor: c.dangerBg, borderRadius: radius.md, paddingHorizontal: space.md },
  failure: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 48 },
  failureBorder: { borderTopWidth: 1, borderTopColor: 'rgba(180,35,24,0.2)' },
});
