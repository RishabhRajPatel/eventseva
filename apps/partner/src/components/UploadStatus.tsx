import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { UploadProgress } from '../hooks/usePhotoUpload';
import { c, radius, space } from '../lib/theme';
import { Txt } from './Txt';

/** "Uploading 2 of 5…" while files go to Cloudinary. */
export function UploadStatus({ progress }: { progress: UploadProgress | null }) {
  const { t } = useTranslation();
  if (!progress) return null;
  return (
    <View style={styles.box} testID="upload-status" accessibilityLiveRegion="polite">
      <ActivityIndicator color={c.royal} />
      <Txt size="sm" variant="bold" style={{ flex: 1 }}>
        {t('photos.uploading', { n: Math.min(progress.done + 1, progress.total), total: progress.total })}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: c.lavender, borderRadius: radius.md, padding: space.md },
});
