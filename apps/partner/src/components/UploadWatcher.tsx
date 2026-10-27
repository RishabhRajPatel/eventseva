import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { invalidateMedia } from '../lib/queries';
import { toast } from '../lib/toast';
import { mediaUploads } from '../lib/uploadQueue';

/** Mounted once: refreshes the photo list as uploads finish and sums up each batch in a toast. */
export function UploadWatcher() {
  const qc = useQueryClient();
  const { t } = useTranslation();
  useEffect(
    () =>
      mediaUploads.on({
        onDone: () => invalidateMedia(qc),
        onIdle: ({ done, failed }) => {
          if (failed && done) toast.error(t('upload.someFailed', { done, failed }));
          else if (failed) toast.error(t('upload.allFailed', { count: failed }));
          else toast.success(t('upload.allDone', { count: done }));
        },
      }),
    [qc, t],
  );
  return null;
}
