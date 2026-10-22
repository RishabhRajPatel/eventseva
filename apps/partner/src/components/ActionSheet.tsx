import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { c, radius, space, TOUCH } from '../lib/theme';
import { Txt } from './Txt';

export interface SheetAction {
  label: string;
  onPress: () => void;
  destructive?: boolean;
  testID?: string;
}

/** A list of choices from the bottom (Android alerts allow only three buttons). */
export function ActionSheet({ visible, title, message, actions, onClose }: { visible: boolean; title: string; message?: string; actions: SheetAction[]; onClose: () => void }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('common.close')} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}>
        <Txt variant="bold" size="lg">
          {title}
        </Txt>
        {message ? <Txt size="sm">{message}</Txt> : null}
        {actions.map((a) => (
          <Pressable
            key={a.label}
            testID={a.testID}
            accessibilityRole="button"
            onPress={() => {
              onClose();
              a.onPress();
            }}
            style={({ pressed }) => [styles.action, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Txt variant="bold" size="md" color={a.destructive ? c.danger : c.royal}>
              {a.label}
            </Txt>
          </Pressable>
        ))}
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.action}>
          <Txt size="md">{t('common.cancel')}</Txt>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(35,38,47,0.45)' },
  sheet: { backgroundColor: c.white, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.xl, gap: space.xs, width: '100%', maxWidth: 640, alignSelf: 'center' },
  action: { minHeight: TOUCH, justifyContent: 'center', borderTopWidth: 1, borderTopColor: c.lavender },
});
