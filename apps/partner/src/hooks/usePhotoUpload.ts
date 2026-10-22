import { useState } from 'react';
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { errorText } from '../lib/errors';
import { invalidateMedia } from '../lib/queries';
import { uploadMedia } from '../lib/upload';

export interface UploadProgress {
  done: number;
  total: number;
}

/** Pick photos/videos from the gallery and upload them one by one, with progress and errors. */
export function usePhotoUpload({ limit = 10, videos = true }: { limit?: number; videos?: boolean } = {}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [progress, setProgress] = useState<UploadProgress | null>(null);

  async function pick() {
    if (limit <= 0) {
      Alert.alert(t('photos.limitTitle'), t('photos.limitBody'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: videos ? ['images', 'videos'] : ['images'],
      allowsMultipleSelection: true,
      selectionLimit: limit,
      quality: 1,
    });
    if (result.canceled || !result.assets.length) return;
    const assets = result.assets.slice(0, limit);
    const failures: string[] = [];
    setProgress({ done: 0, total: assets.length });
    for (const [i, a] of assets.entries()) {
      try {
        await uploadMedia({
          uri: a.uri,
          type: a.type === 'video' ? 'video' : 'photo',
          width: a.width,
          height: a.height,
          fileSize: a.fileSize,
          mimeType: a.mimeType,
          fileName: a.fileName,
        });
      } catch (e) {
        failures.push(errorText(t, e));
      }
      setProgress({ done: i + 1, total: assets.length });
    }
    setProgress(null);
    invalidateMedia(qc);
    if (failures.length) {
      const unique = [...new Set(failures)];
      Alert.alert(t('photos.failedTitle', { n: failures.length, total: assets.length }), unique.join('\n'));
    }
  }

  return { pick, busy: progress !== null, progress };
}
