import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { c, DISABLED_OPACITY, PRESSED_OPACITY, radius, space, TOUCH } from '../lib/theme';
import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';

export interface SheetAction {
  label: string;
  onPress: () => void;
  icon?: IconName;
  destructive?: boolean;
  disabled?: boolean;
  testID?: string;
}

/** A list of choices from the bottom (Android alerts allow only three buttons). */
export function ActionSheet({ visible, title, message, actions, onClose }: { visible: boolean; title: string; message?: string; actions: SheetAction[]; onClose: () => void }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('common.close')} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]} testID="action-sheet">
        <View style={styles.handle} />
        <Txt variant="bold" size="lg">
          {title}
        </Txt>
        {message ? (
          <Txt size="sm" style={{ lineHeight: 20 }}>
            {message}
          </Txt>
        ) : null}
        <View style={{ marginTop: space.sm }}>
          {actions.map((a) => {
            const color = a.destructive ? c.danger : c.royal;
            return (
              <Pressable
                key={a.label}
                testID={a.testID}
                accessibilityRole="button"
                accessibilityState={{ disabled: !!a.disabled }}
                disabled={a.disabled}
                onPress={() => {
                  onClose();
                  a.onPress();
                }}
                style={({ pressed }) => [styles.action, { opacity: a.disabled ? DISABLED_OPACITY : pressed ? PRESSED_OPACITY : 1 }]}
              >
                {a.icon ? <Icon name={a.icon} size={20} color={color} /> : null}
                <Txt variant="bold" size="md" color={color}>
                  {a.label}
                </Txt>
              </Pressable>
            );
          })}
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.action}>
            <Txt size="md">{t('common.cancel')}</Txt>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: c.scrim },
  sheet: { backgroundColor: c.white, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.xl, paddingTop: space.md, gap: space.xs, width: '100%', maxWidth: 640, alignSelf: 'center' },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: c.lilac, marginBottom: space.sm },
  action: { minHeight: TOUCH + 4, flexDirection: 'row', alignItems: 'center', gap: space.md, borderTopWidth: 1, borderTopColor: c.lavender },
});
