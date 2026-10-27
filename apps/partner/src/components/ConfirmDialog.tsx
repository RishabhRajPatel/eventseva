import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { answerConfirm, confirmStore } from '../lib/confirm';
import { useStore } from '../lib/store';
import { c, radius, space } from '../lib/theme';
import { Button } from './Button';
import { Icon } from './Icon';
import { Txt } from './Txt';

/** The one confirm dialog of the app (UX.md §4). Mounted once, in the root layout. */
export function ConfirmHost() {
  const p = useStore(confirmStore);
  if (!p) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => answerConfirm(false)} statusBarTranslucent>
      <View style={styles.center}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => answerConfirm(false)} accessibilityLabel={p.cancelLabel} />
        <View style={styles.box} testID="confirm-dialog" accessibilityViewIsModal>
          {p.destructive ? (
            <View style={styles.icon}>
              <Icon name="trash" size={22} color={c.danger} />
            </View>
          ) : null}
          <Txt variant="display" size="xl" accessibilityRole="header">
            {p.title}
          </Txt>
          {p.body ? (
            <Txt size="md" style={{ lineHeight: 22 }}>
              {p.body}
            </Txt>
          ) : null}
          <View style={styles.buttons}>
            <Button testID="confirm-yes" kind={p.destructive ? 'danger' : 'primary'} label={p.confirmLabel} onPress={() => answerConfirm(true)} />
            <Button testID="confirm-no" kind="secondary" label={p.cancelLabel} onPress={() => answerConfirm(false)} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: c.scrim, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  box: { width: '100%', maxWidth: 420, backgroundColor: c.white, borderRadius: radius.xl, padding: space.xl, gap: space.md },
  icon: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.dangerBg, alignItems: 'center', justifyContent: 'center' },
  buttons: { gap: space.sm, marginTop: space.sm },
});
