import { useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { DocType, VendorDocument } from '@eventseva/app-shared';
import { errorText } from '../lib/errors';
import { keys, useDocuments } from '../lib/queries';
import { uploadDocument } from '../lib/upload';
import { c, radius, space } from '../lib/theme';
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

/** Verification documents (VendorDocs board). Files are private: only EventSeva verifiers can open them. */
export function DocumentsCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const documents = useDocuments();
  const [askLast4, setAskLast4] = useState(false);
  const upload = useMutation({
    mutationFn: async ({ type, last4 }: { type: DocType; last4?: string }) => {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
      if (result.canceled || !result.assets.length) return null;
      const a = result.assets[0];
      return uploadDocument({ uri: a.uri, type: 'photo', width: a.width, height: a.height, fileSize: a.fileSize, mimeType: a.mimeType, fileName: a.fileName }, type, last4);
    },
    onSuccess: (doc) => {
      if (doc) void qc.invalidateQueries({ queryKey: keys.documents });
    },
    onError: (e) => Alert.alert(t('errors.title'), errorText(t, e)),
  });

  const byType = new Map((documents.data ?? []).map((d) => [d.docType, d]));
  const start = (type: DocType) => (type === 'aadhaar' ? setAskLast4(true) : upload.mutate({ type }));

  return (
    <View style={{ gap: space.md }} testID="documents">
      {DOCS.map((d) => {
        const doc = byType.get(d.type);
        const busy = upload.isPending && upload.variables?.type === d.type;
        const done = doc && doc.status !== 'rejected';
        return (
          <Card key={d.type} style={styles.row} testID={`doc-${d.type}`}>
            <View style={[styles.icon, { backgroundColor: done ? c.mint : c.lavender }]}>
              <Icon name={done ? 'check' : 'upload'} size={20} color={done ? c.ink : c.royal} />
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
            <Button
              testID={`upload-${d.type}`}
              label={doc ? (doc.status === 'rejected' ? t('docs.uploadAgain') : t('common.change')) : t('docs.upload')}
              kind={!doc && d.required ? 'primary' : 'secondary'}
              loading={busy}
              disabled={upload.isPending && !busy}
              onPress={() => start(d.type)}
            />
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
          upload.mutate({ type: 'aadhaar', last4 });
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
  backdrop: { flex: 1, backgroundColor: 'rgba(35,38,47,0.45)' },
  sheet: { backgroundColor: c.cream, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.xl, gap: space.lg, width: '100%', maxWidth: 640, alignSelf: 'center' },
});
