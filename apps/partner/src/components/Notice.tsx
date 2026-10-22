import { StyleSheet, View } from 'react-native';
import type { ReactNode } from 'react';
import { c, radius, space } from '../lib/theme';
import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';

type Tone = 'info' | 'success' | 'warning' | 'danger' | 'plain';
const BG: Record<Tone, string> = { info: c.lavender, success: c.mintLight, warning: c.peach, danger: c.dangerBg, plain: c.white };

/** An inline message box (hints, "coming soon", reject reasons). */
export function Notice({ children, icon, tone = 'info', title, testID }: { children?: ReactNode; icon?: IconName; tone?: Tone; title?: string; testID?: string }) {
  const fg = tone === 'danger' ? c.danger : tone === 'info' ? c.royal : c.ink;
  return (
    <View testID={testID} style={[styles.box, { backgroundColor: BG[tone] }]} accessibilityRole={tone === 'danger' ? 'alert' : undefined}>
      {icon ? (
        <View style={{ paddingTop: 2 }}>
          <Icon name={icon} size={18} color={fg} />
        </View>
      ) : null}
      <View style={{ flex: 1, gap: space.xs }}>
        {title ? (
          <Txt variant="bold" size="md" color={tone === 'danger' ? c.danger : c.ink}>
            {title}
          </Txt>
        ) : null}
        {typeof children === 'string' ? (
          <Txt size="sm" style={{ lineHeight: 20 }}>
            {children}
          </Txt>
        ) : (
          children
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.md, padding: space.md, paddingHorizontal: space.lg, flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
});
