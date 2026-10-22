import { useState } from 'react';
import { Alert, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { Media } from '@eventseva/app-shared';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { coverOf, remainingSlots, wideUrl } from '../lib/media';
import { invalidateMedia, useMedia, useVendor, type MediaPage } from '../lib/queries';
import { canEdit } from '../lib/routing';
import { c, radius, space } from '../lib/theme';
import { usePhotoUpload } from '../hooks/usePhotoUpload';
import { useIsTablet } from '../hooks/useIsTablet';
import { ActionSheet, type SheetAction } from '../components/ActionSheet';
import { Button } from '../components/Button';
import { Card, CardHeader, Row } from '../components/Card';
import { Icon } from '../components/Icon';
import { MediaGrid } from '../components/MediaGrid';
import { Screen } from '../components/Screen';
import { QueryView } from '../components/States';
import { Txt } from '../components/Txt';
import { UploadStatus } from '../components/UploadStatus';

/** All photos and videos with their review status: add, set the cover, delete. */
export default function PhotosScreen() {
  const { t } = useTranslation();
  const media = useMedia();
  return (
    <Screen back title={t('photos.title')} refreshing={media.isRefetching} onRefresh={() => void media.refetch()} testID="photos">
      <QueryView query={media}>{(page) => <Photos page={page} />}</QueryView>
    </Screen>
  );
}

function Photos({ page }: { page: MediaPage }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { width } = useWindowDimensions();
  const tablet = useIsTablet();
  const vendor = useVendor();
  const editable = canEdit(vendor.data?.status);
  const media = page.items;
  const left = remainingSlots(media, page.limits);
  const upload = usePhotoUpload({ limit: left });
  const [selected, setSelected] = useState<Media | null>(null);
  const cover = coverOf(media);
  const coverUrl = cover ? wideUrl(cover, Math.min(width, 760)) : null;
  const rejected = media.filter((m) => m.status === 'rejected');
  const photos = media.filter((m) => m.type === 'photo' && m.status !== 'rejected').length;
  const videos = media.filter((m) => m.type === 'video' && m.status !== 'rejected').length;

  const onError = (e: unknown) => Alert.alert(t('errors.title'), errorText(t, e));
  const makeCover = useMutation({ mutationFn: (id: string) => api.post(`/v1/partner/media/${id}/cover`), onSuccess: () => invalidateMedia(qc), onError });
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/v1/partner/media/${id}`), onSuccess: () => invalidateMedia(qc), onError });
  const move = useMutation({
    mutationFn: (ids: string[]) => api.put('/v1/partner/media/order', { ids }),
    onMutate: (ids) => {
      // Show the new order at once; the refetch after confirms it.
      qc.setQueryData<MediaPage>(['media'], (old) => (old ? { ...old, items: ids.map((id) => old.items.find((m) => m.id === id)!).filter(Boolean) } : old));
    },
    onSettled: () => invalidateMedia(qc),
    onError,
  });

  function moveBy(m: Media, by: -1 | 1) {
    const ids = media.map((x) => x.id);
    const i = ids.indexOf(m.id);
    const j = i + by;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    move.mutate(ids);
  }

  function sheetActions(m: Media): SheetAction[] {
    const list: SheetAction[] = [];
    if (m.type === 'photo' && m.status !== 'rejected' && !m.isCover) list.push({ label: t('photos.makeCover'), testID: 'make-cover', onPress: () => makeCover.mutate(m.id) });
    list.push({ label: t('photos.moveEarlier'), onPress: () => moveBy(m, -1) });
    list.push({ label: t('photos.moveLater'), onPress: () => moveBy(m, 1) });
    list.push({
      label: t('common.delete'),
      destructive: true,
      testID: 'delete-media',
      onPress: () =>
        Alert.alert(t('photos.deleteTitle'), t('photos.deleteBody'), [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('common.delete'), style: 'destructive', onPress: () => remove.mutate(m.id) },
        ]),
    });
    return list;
  }

  return (
    <>
      <View style={styles.cover} testID="cover">
        {coverUrl && cover ? (
          <Image source={{ uri: coverUrl }} style={{ width: '100%', aspectRatio: cover.width / cover.height || 16 / 9 }} contentFit="contain" placeholder={cover.blurhash ? { blurhash: cover.blurhash } : undefined} />
        ) : (
          <View style={styles.placeholder}>
            <Icon name="image" size={40} color={c.royal} strokeWidth={1.5} />
            <Txt size="sm" align="center">
              {cover ? t('photos.previewUnavailable') : t('photos.noCover')}
            </Txt>
          </View>
        )}
      </View>
      <UploadStatus progress={upload.progress} />
      <Card>
        <CardHeader
          title={t('photos.all')}
          right={
            <Txt size="sm" color={c.textMuted}>
              {t('photos.limits', { photos, maxPhotos: page.limits.photos, videos, maxVideos: page.limits.videos })}
            </Txt>
          }
        />
        <MediaGrid media={media} columns={tablet ? 6 : 4} onAdd={editable ? () => void upload.pick() : undefined} adding={upload.busy} canAdd={left > 0} onPressItem={editable ? setSelected : undefined} />
        <Txt size="xs" color={c.textMuted}>
          {t('photos.guidelines')} {t('photos.reviewNote')} {editable ? t('photos.tapHint') : ''}
        </Txt>
      </Card>
      {rejected.length ? (
        <Card testID="rejected-media">
          <CardHeader title={t('photos.rejectedTitle')} />
          {rejected.map((m, i) => (
            <Row key={m.id} first={i === 0}>
              <Txt size="sm" style={{ flex: 1 }}>
                {m.rejectReason || t('photos.rejectedNoReason')}
              </Txt>
            </Row>
          ))}
        </Card>
      ) : null}
      {selected ? (
        <ActionSheet
          visible
          title={selected.type === 'video' ? t('photos.video') : t('photos.photo')}
          message={t(`photos.status.${selected.status ?? 'approved'}`) + (selected.status === 'rejected' && selected.rejectReason ? `: ${selected.rejectReason}` : '')}
          actions={sheetActions(selected)}
          onClose={() => setSelected(null)}
        />
      ) : null}
      {editable ? <Button testID="add-photos" size="lg" icon="plus" label={t('photos.add')} loading={upload.busy} disabled={left <= 0} onPress={() => void upload.pick()} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  cover: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: c.lavender },
  placeholder: { aspectRatio: 16 / 9, alignItems: 'center', justifyContent: 'center', gap: space.sm, padding: space.xl },
});
