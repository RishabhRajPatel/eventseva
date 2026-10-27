import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { c, space } from '../lib/theme';
import { LinkButton } from './Button';
import { Icon } from './Icon';
import { Txt } from './Txt';

/** Slim "No internet. Showing saved data." bar with a manual Retry (UX.md §5). */
export function OfflineBanner({ onRetry, topInset = 0 }: { onRetry: () => void; topInset?: number }) {
  const { t } = useTranslation();
  return (
    <View style={[styles.bar, { paddingTop: topInset }]} testID="offline-banner" accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Icon name="wifiOff" size={18} color={c.onWarning} />
      <Txt variant="bold" size="sm" color={c.onWarning} style={{ flex: 1 }}>
        {t('offline.banner')}
      </Txt>
      <LinkButton testID="offline-retry" label={t('common.tryAgain')} color={c.onWarning} onPress={onRetry} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: c.peach, paddingHorizontal: space.lg },
});
