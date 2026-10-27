import { useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { DocType, VendorDocument } from '@eventseva/app-shared';
import { errorCode, errorText } from '../lib/errors';
import { keys, useDocuments } from '../lib/queries';
import { toast } from '../lib/toast';
import { uploadDocument, type UploadStage } from '../lib/upload';
import { c, radius, space } from '../lib/theme';
import { toPicked } from '../hooks/usePhotoUpload';
import { Button } from './Button';
import { Card } from './Card';
import { Pill, type Tone } from './Chip';
import { Field } from './Field';
import { Icon } from './Icon';
import { Txt } from './Txt';

const DOCS: Array<{ type: DocType; required: boolean }> = [
  { type: 'aadhaar', required: true },
  { type: 'pan', required: true },
  { type: 'gst', required: false },
  { type: 'shop_photo', required: false },
];
const TONE: Record<VendorDocument['status'], Tone> = { pending: 'warning', approved: 'success', rejected: 'danger' };

export const isValidLast4 = (v: string) => /^\d{4}$/.test(v);

interface Active {
  type: DocType;
  stage: UploadStage;
  progress: number;
}

/**
 * Verification documents (VendorDocs board). Files are private: only EventSeva verifiers can open them.
 * The photo is resized on the phone like work photos, uploads with a progress bar and can be cancelled.
 * (PDFs are not offered: there is no document picker in the app.)
 */
export function DocumentsCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const documents = useDocuments();
  const [askLast4, setAskLast4] = useState(false);
  const [active, setActive] = useState<Active | null>(null);
  const [failed, setFailed] = useState<Partial<Record<DocType, string>>>({});
  const controller = useRef<AbortController | null>(null);

  async function upload(type: DocType, last4?: string) {
    if (controller.current) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (result.canceled || !result.assets.length) return;
    const abort = new AbortController();
    controller.current = abort;
    setFailed((f) => ({ ...f, [type]: undefined }));
    setActive({ type, stage: 'preparing', progress: 0 });
    try {
      await uploadDocument(toPicked(result.assets[0]), type, last4, {
        signal: abort.signal,
        onStage: (stage) => setActive((a) => (a ? { ...a, stage } : a)),
        onProgress: (progress) => setActive((a) => (a && Math.round(a.progress * 100) !== Math.round(progress * 100) ? { ...a, progress } : a)),
      });
      void qc.invalidateQueries({ queryKey: keys.documents });
      toast.success(t('docs.uploaded', { doc: t(`docs.${type}`) }));
    } catch (e) {
      if (errorCode(e) === 'CANCELLED') toast.info(t('upload.cancelledOne'));
      else {
        setFailed((f) => ({ ...f, [type]: errorText(t, e) }));
        toast.error(t('docs.uploadFailed', { doc: t(`docs.${type}`) }));
      }
    } finally {
      controller.current = null;
      setActive(null);
    }
  }

  const byType = new Map((documents.data ?? []).map((d) => [d.docType, d]));
  const start = (type: DocType) => (type === 'aadhaar' ? setAskLast4(true) : upload(type));

  return (
    <View style={{ gap: space.md }} testID="documents">
      {DOCS.map((d) => {
        const doc = byType.get(d.type);
        const busy = active?.type === d.type ? active : null;
        const done = doc && doc.status !== 'rejected';
        const pct = busy ? Math.round(busy.progress * 100) : 0;
        return (
          <Card key={d.type} style={{ gap: space.md }} testID={`doc-${d.type}`}>
            <View style={styles.row}>
              <View style={[styles.icon, { backgroundColor: done ? c.mint : c.lavender }]}>
                <Icon name={done ? 'check' : 'upload'} size={20} color={done ? c.onSuccess : c.royal} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="bold" size="md">
                  {t(`docs.${d.type}`)}
                </Txt>
                {doc ? (
                  <>
                    {doc.last4 ? <Txt size="sm">XXXX XXXX {doc.last4}</Txt> : null}
                    <Pill label={t(`docs.status.${doc.status}`)} tone={TONE[doc.status]} />
                    {doc.status === 'rejected' && doc.rejectReason ? (
                      <Txt size="sm" color={c.danger}>
                        {doc.rejectReason}
                      </Txt>
                    ) : null}
                  </>
                ) : (
                  <Txt size="sm" color={c.textMuted}>
                    {d.required ? t('docs.required') : t('docs.optional')}
                  </Txt>
                )}
              </View>
              {busy ? (
                <Button testID={`cancel-${d.type}`} kind="outline" label={t('upload.cancel')} onPress={() => controller.current?.abort()} />
              ) : (
                <Button
                  testID={`upload-${d.type}`}
                  label={doc ? (doc.status === 'rejected' ? t('docs.uploadAgain') : t('common.change')) : t('docs.upload')}
                  kind={!doc && d.required ? 'primary' : 'secondary'}
                  disabled={!!active}
                  onPress={() => start(d.type)}
                />
              )}
            </View>
            {busy ? (
              <View style={{ gap: space.xs }} testID={`progress-${d.type}`} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pct }}>
                <Txt size="sm" variant="bold" color={c.royal}>
                  {busy.stage === 'preparing' ? t('upload.preparing') : busy.stage === 'saving' ? t('upload.saving') : t('upload.percent', { n: pct })}
                </Txt>
                <View style={styles.track}>
                  <View style={[styles.fill, { width: `${busy.stage === 'saving' ? 100 : busy.stage === 'uploading' ? pct : 0}%` }]} />
                </View>
              </View>
            ) : failed[d.type] ? (
              <Txt size="sm" color={c.danger} accessibilityRole="alert" testID={`doc-error-${d.type}`}>
                {failed[d.type]}
              </Txt>
            ) : null}
          </Card>
        );
      })}
      <View style={styles.privacy}>
        <Icon name="lock" size={16} color={c.royal} />
        <Txt size="sm" style={{ flex: 1, lineHeight: 19 }}>
          {t('docs.aadhaarNote')} {t('docs.privacy')}
        </Txt>
      </View>
      <Last4Sheet
        visible={askLast4}
        onClose={() => setAskLast4(false)}
        onDone={(last4) => {
          setAskLast4(false);
          void upload('aadhaar', last4);
        }}
      />
    </View>
  );
}

/** Only the last 4 digits of Aadhaar are ever asked for and stored. */
function Last4Sheet({ visible, onClose, onDone }: { visible: boolean; onClose: () => void; onDone: (last4: string) => void }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [value, setValue] = useState('');
  const [tried, setTried] = useState(false);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('common.close')} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}>
        <Txt variant="display" size="xl">
          {t('docs.last4Title')}
        </Txt>
        <Txt size="sm">{t('docs.aadhaarNote')}</Txt>
        <Field
          testID="aadhaar-last4"
          label={t('docs.last4Label')}
          value={value}
          onChangeText={(v) => setValue(v.replace(/\D/g, '').slice(0, 4))}
          keyboardType="number-pad"
          maxLength={4}
          autoFocus
          placeholder="1234"
          error={tried && !isValidLast4(value) ? t('docs.last4Error') : null}
        />
        <Button
          testID="last4-continue"
          label={t('docs.chooseFile')}
          onPress={() => {
            setTried(true);
            if (isValidLast4(value)) onDone(value);
          }}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  icon: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  privacy: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  track: { height: 8, borderRadius: 4, backgroundColor: c.lavender, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: c.royal },
  backdrop: { flex: 1, backgroundColor: c.scrim },
  sheet: { backgroundColor: c.cream, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.xl, gap: space.lg, width: '100%', maxWidth: 640, alignSelf: 'center' },
});
