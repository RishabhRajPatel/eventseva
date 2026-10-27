import { useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import type { Media } from '@eventseva/app-shared';
import { coverOf, wideUrl } from '../lib/media';
import { useMedia, useVendor, type MediaPage } from '../lib/queries';
import { canEdit } from '../lib/routing';
import { c, radius, space } from '../lib/theme';
import { useMediaActions } from '../hooks/useMediaActions';
import { usePhotoUpload } from '../hooks/usePhotoUpload';
import { useIsTablet } from '../hooks/useIsTablet';
import { ActionSheet, type SheetAction } from '../components/ActionSheet';
import { Button } from '../components/Button';
import { Card, CardHeader, Row } from '../components/Card';
import { Icon } from '../components/Icon';
import { MediaGrid } from '../components/MediaGrid';
import { MediaViewer } from '../components/MediaViewer';
import { Notice } from '../components/Notice';
import { Screen } from '../components/Screen';
import { QueryView } from '../components/States';
import { Txt } from '../components/Txt';

/** All photos and videos with their review status: add (with progress), view, set the cover, move, delete. */
export default function PhotosScreen() {
  const { t } = useTranslation();
  const media = useMedia();
  return (
    <Screen back title={t('photos.title')} refreshing={media.isRefetching} onRefresh={() => void media.refetch()} testID="photos">
      <QueryView query={media} skeleton="grid">
        {(page) => <Photos page={page} />}
      </QueryView>
    </Screen>
  );
}

function Photos({ page }: { page: MediaPage }) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const tablet = useIsTablet();
  const vendor = useVendor();
  const editable = canEdit(vendor.data?.status);
  const actions = useMediaActions(page.items);
  const media = actions.visible;
  const upload = usePhotoUpload({ media, limits: page.limits });
  const [viewing, setViewing] = useState<Media | null>(null);
  const [sheetFor, setSheetFor] = useState<Media | null>(null);
  const cover = coverOf(media);
  const coverUrl = cover ? wideUrl(cover, Math.min(width, 760)) : null;
  const rejected = media.filter((m) => m.status === 'rejected');
  const photos = media.filter((m) => m.type === 'photo' && m.status !== 'rejected').length;
  const videos = media.filter((m) => m.type === 'video' && m.status !== 'rejected').length;

  // The viewer and the sheet are both modals: close one before opening the other.
  const openOptions = (m: Media) => {
    setViewing(null);
    setSheetFor(m);
  };

  function sheetActions(m: Media): SheetAction[] {
    const i = media.findIndex((x) => x.id === m.id);
    const list: SheetAction[] = [];
    if (m.type === 'photo' && m.status !== 'rejected' && !m.isCover) list.push({ label: t('photos.makeCover'), icon: 'star', testID: 'make-cover', onPress: () => actions.makeCover(m.id) });
    list.push({ label: t('photos.moveEarlier'), icon: 'back', testID: 'move-earlier', disabled: i <= 0, onPress: () => actions.move(m, -1) });
    list.push({ label: t('photos.moveLater'), icon: 'next', testID: 'move-later', disabled: i < 0 || i >= media.length - 1, onPress: () => actions.move(m, 1) });
    list.push({ label: t(m.type === 'video' ? 'photos.deleteVideo' : 'photos.deletePhoto'), icon: 'trash', destructive: true, testID: 'delete-media', onPress: () => void actions.remove(m) });
    return list;
  }

  return (
    <>
      <Pressable
        style={styles.cover}
        testID="cover"
        disabled={!cover}
        onPress={() => cover && setViewing(cover)}
        accessibilityRole={cover ? 'imagebutton' : undefined}
        accessibilityLabel={cover ? t('photos.coverLabel') : t('photos.noCover')}
      >
        {coverUrl && cover ? (
          <Image
            source={{ uri: coverUrl }}
            style={{ width: '100%', aspectRatio: cover.width / cover.height || 16 / 9 }}
            contentFit="contain"
            cachePolicy="memory-disk"
            recyclingKey={cover.id}
            transition={150}
            placeholder={cover.blurhash ? { blurhash: cover.blurhash } : undefined}
          />
        ) : (
          <View style={styles.placeholder}>
            <Icon name="image" size={40} color={c.royal} strokeWidth={1.5} />
            <Txt size="sm" align="center">
              {cover ? t('photos.previewUnavailable') : t('photos.noCover')}
            </Txt>
          </View>
        )}
      </Pressable>
      <Card>
        <CardHeader
          title={t('photos.all')}
          right={
            <Txt size="sm" color={c.textMuted}>
              {t('photos.limits', { photos, maxPhotos: page.limits.photos, videos, maxVideos: page.limits.videos })}
            </Txt>
          }
        />
        <MediaGrid
          media={media}
          uploads={upload.items}
          columns={tablet ? 6 : 3}
          onAdd={editable ? () => void upload.pick() : undefined}
          canAdd={upload.canAdd}
          onOpen={setViewing}
          onMore={editable ? openOptions : undefined}
          selectedId={sheetFor?.id}
          onCancelUpload={upload.cancel}
          onRetryUpload={upload.retry}
          onDismissUpload={upload.dismiss}
        />
        <Txt size="xs" color={c.textMuted} style={{ lineHeight: 17 }}>
          {t('photos.guidelines')} {t('photos.reviewNote')} {editable ? t('photos.tapHint') : ''}
        </Txt>
      </Card>
      {!upload.canAdd && editable ? <Notice icon="alert" tone="warning">{t('photos.limitBody')}</Notice> : null}
      {rejected.length ? (
        <Card testID="rejected-media">
          <CardHeader title={t('photos.rejectedTitle')} />
          {rejected.map((m, i) => (
            <Row key={m.id} first={i === 0} onPress={() => setViewing(m)} chevron>
              <Txt size="sm" style={{ flex: 1, lineHeight: 19 }}>
                {m.rejectReason || t('photos.rejectedNoReason')}
              </Txt>
            </Row>
          ))}
        </Card>
      ) : null}
      {viewing ? <MediaViewer media={viewing} list={media} onChange={setViewing} onClose={() => setViewing(null)} onOptions={editable ? openOptions : undefined} /> : null}
      {sheetFor ? (
        <ActionSheet
          visible
          title={t(sheetFor.type === 'video' ? 'photos.video' : 'photos.photo')}
          message={t(`photos.status.${sheetFor.status ?? 'approved'}`) + (sheetFor.status === 'rejected' && sheetFor.rejectReason ? `: ${sheetFor.rejectReason}` : '')}
          actions={sheetActions(sheetFor)}
          onClose={() => setSheetFor(null)}
        />
      ) : null}
      {editable ? (
        <Button
          testID="add-photos"
          size="lg"
          icon="plus"
          label={upload.busy ? t('upload.addMore') : t('photos.add')}
          disabled={!upload.canAdd}
          onPress={() => upload.pick()}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  cover: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: c.lavender },
  placeholder: { aspectRatio: 16 / 9, alignItems: 'center', justifyContent: 'center', gap: space.sm, padding: space.xl },
});
