import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

/**
 * Staggered columns as on the Search board: each item goes into the currently shortest column,
 * so photos keep their own shape. Width comes from layout, never from a fixed screen size.
 */
export function MasonryGrid<T extends { id: string }>({
  items,
  columns,
  gap = 16,
  estimateHeight,
  renderItem,
  initialWidth = 0,
}: {
  items: T[];
  columns: number;
  gap?: number;
  estimateHeight: (item: T, width: number) => number;
  renderItem: (item: T, width: number) => ReactNode;
  /** Best guess before the first layout pass (window width minus padding). */
  initialWidth?: number;
}) {
  const [width, setWidth] = useState(initialWidth);
  const colWidth = width > 0 ? Math.floor((width - gap * (columns - 1)) / columns) : 0;

  const cols: T[][] = Array.from({ length: columns }, () => []);
  const heights = new Array<number>(columns).fill(0);
  for (const item of items) {
    const i = heights.indexOf(Math.min(...heights));
    cols[i].push(item);
    heights[i] += estimateHeight(item, colWidth || 160) + gap;
  }

  return (
    <View style={[styles.row, { gap }]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {colWidth > 0
        ? cols.map((col, i) => (
            <View key={i} style={[styles.col, { gap, width: colWidth }]}>
              {col.map((item) => (
                <View key={item.id}>{renderItem(item, colWidth)}</View>
              ))}
            </View>
          ))
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', width: '100%' },
  col: {},
});
