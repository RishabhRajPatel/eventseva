import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { c, radius, space } from '../lib/theme';
import { AppText } from './AppText';
import { IconButton } from './Button';

/** Bottom sheet for short tasks on a screen (cancel a booking, write a review). */
export function Sheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('common.close')} accessibilityRole="button" />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.head}>
            <AppText variant="display" size="xl" accessibilityRole="header" style={styles.flex}>
              {title}
            </AppText>
            <IconButton icon="close" label={t('common.close')} onPress={onClose} tone="lavender" />
          </View>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(35,38,47,0.45)' },
  sheet: { backgroundColor: c.background, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: '88%', width: '100%', maxWidth: 640, alignSelf: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.xl, paddingTop: space.lg },
  body: { paddingHorizontal: space.xl, paddingVertical: space.lg, gap: space.lg },
});
