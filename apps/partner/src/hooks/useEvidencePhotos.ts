import { useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';
import { errorText } from '../lib/errors';
import { toast } from '../lib/toast';
import { uploadEvidencePhoto, type SignedPhoto } from '../lib/upload';
import { toPicked } from './usePhotoUpload';

export const MAX_EVIDENCE = 10;

/** Photos kept with a delivery, return or handover record: picked, uploaded one by one, sent signed. */
export function useEvidencePhotos() {
  const { t } = useTranslation();
  const [photos, setPhotos] = useState<SignedPhoto[]>([]);
  const [uploading, setUploading] = useState(false);

  async function add() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: MAX_EVIDENCE - photos.length, quality: 1 });
    if (result.canceled) return;
    setUploading(true);
    try {
      for (const a of result.assets) {
        const photo = await uploadEvidencePhoto(toPicked(a));
        setPhotos((p) => [...p, photo]);
      }
    } catch (e) {
      toast.error(errorText(t, e));
    } finally {
      setUploading(false);
    }
  }

  return { photos, uploading, add, clear: () => setPhotos([]), full: photos.length >= MAX_EVIDENCE };
}
