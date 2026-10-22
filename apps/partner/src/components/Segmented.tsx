import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { c, radius, space, TOUCH } from '../lib/theme';
import { Txt } from './Txt';

/** Tab-like segment switcher (Bookings: New / Waiting / Upcoming / Past). */
export function Segmented<K extends string>({ options, value, onChange }: { options: Array<{ key: K; label: string; count?: number }>; value: K; onChange: (k: K) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1 }}>
      <View style={styles.wrap} accessibilityRole="tablist">
        {options.map((o) => {
          const on = o.key === value;
          return (
            <Pressable
              key={o.key}
              testID={`segment-${o.key}`}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              onPress={() => onChange(o.key)}
              style={[styles.item, on ? styles.on : null]}
            >
              <Txt variant={on ? 'bold' : 'body'} size="sm" color={on ? c.white : c.ink} numberOfLines={1}>
                {o.count ? `${o.label} (${o.count})` : o.label}
              </Txt>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flexGrow: 1, flexDirection: 'row', backgroundColor: c.white, borderRadius: radius.md, padding: space.xs, gap: space.xs },
  item: { flexGrow: 1, minHeight: TOUCH - 4, paddingHorizontal: space.md, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  on: { backgroundColor: c.royal },
});
