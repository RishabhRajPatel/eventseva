import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { c, radius, space } from '../lib/theme';
import { Button } from './Button';
import { ChoiceChip } from './Chip';
import { Field } from './Field';
import { Notice } from './Notice';
import { Txt } from './Txt';

/** Bottom sheet asking why (decline a request, cancel a booking): quick picks plus free text. */
export function ReasonSheet({
  visible,
  title,
  message,
  quickReasons,
  confirmLabel,
  loading,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  title: string;
  message?: string;
  quickReasons: string[];
  confirmLabel: string;
  loading?: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [picked, setPicked] = useState<string | null>(null);
  const [extra, setExtra] = useState('');
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (visible) {
      setPicked(null);
      setExtra('');
      setTried(false);
    }
  }, [visible]);

  const reason = [picked, extra.trim()].filter(Boolean).join('. ');
  const valid = reason.length >= 3 && reason.length <= 300;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('common.close')} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: space.lg }}>
          <Txt variant="display" size="xl">
            {title}
          </Txt>
          {message ? <Notice icon="alert" tone="warning">{message}</Notice> : null}
          <View style={styles.chips}>
            {quickReasons.map((r) => (
              <ChoiceChip key={r} label={r} selected={picked === r} onPress={() => setPicked(picked === r ? null : r)} />
            ))}
          </View>
          <Field
            testID="reason-input"
            label={t('reason.more')}
            value={extra}
            onChangeText={setExtra}
            multiline
            maxLength={250}
            placeholder={t('reason.placeholder')}
            error={tried && !valid ? t('reason.required') : null}
          />
          <View style={styles.buttons}>
            <Button kind="outline" label={t('common.back')} onPress={onClose} style={{ flex: 1 }} />
            <Button
              testID="reason-confirm"
              kind="danger"
              label={confirmLabel}
              loading={loading}
              onPress={() => {
                setTried(true);
                if (valid) onConfirm(reason);
              }}
              style={{ flex: 1 }}
            />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(35,38,47,0.45)' },
  sheet: { backgroundColor: c.cream, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.xl, maxHeight: '85%', width: '100%', maxWidth: 640, alignSelf: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  buttons: { flexDirection: 'row', gap: space.sm },
});
