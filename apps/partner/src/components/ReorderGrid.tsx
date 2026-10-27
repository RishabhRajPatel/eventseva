import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import type { Media } from '@eventseva/app-shared';
import { haptic } from '../lib/haptics';
import { thumbUrl } from '../lib/media';
import { c, radius, space } from '../lib/theme';
import { Button } from './Button';
import { Icon } from './Icon';
import { Txt } from './Txt';

/** `list` with the item at `from` moved to `to` (a new array). */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
  return next;
}

/** Which slot a finger at (x, y) inside the grid is over. */
export function slotAt(x: number, y: number, size: number, columns: number, count: number): number {
  const col = Math.max(0, Math.min(columns - 1, Math.floor(x / size)));
  const row = Math.max(0, Math.floor(y / size));
  return Math.max(0, Math.min(count - 1, row * columns + col));
}

const GAP = 6;

/**
 * Drag to re-order (UX.md §6). Each tile follows the finger; the others slide out of the way.
 * Screen readers get "Move earlier / later" actions on every tile instead of dragging.
 * Nothing is saved until "Save order".
 */
export function ReorderGrid({ media, columns, onSave, onCancel }: { media: Media[]; columns: number; onSave: (ids: string[]) => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [order, setOrder] = useState(() => media.map((m) => m.id));
  const [width, setWidth] = useState(0);
  const [dragging, setDragging] = useState<string | null>(null);
  const byId = useMemo(() => new Map(media.map((m) => [m.id, m])), [media]);
  const size = width ? width / columns : 0;
  const orderRef = useRef(order);
  orderRef.current = order;

  // One animated position per tile, moved to its slot whenever the order changes.
  const positions = useRef(new Map<string, Animated.ValueXY>()).current;
  const slot = useCallback((i: number) => ({ x: (i % columns) * size, y: Math.floor(i / columns) * size }), [columns, size]);
  const pos = (id: string) => {
    let p = positions.get(id);
    if (!p) positions.set(id, (p = new Animated.ValueXY(slot(Math.max(0, order.indexOf(id))))));
    return p;
  };
  useEffect(() => {
    order.forEach((id, i) => {
      if (id === dragging) return;
      Animated.spring(pos(id), { toValue: slot(i), useNativeDriver: false, speed: 20, bounciness: 4 }).start();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, size, dragging]);

  const moveBy = (id: string, by: -1 | 1) => {
    const i = orderRef.current.indexOf(id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= orderRef.current.length) return;
    haptic.select();
    setOrder((o) => moveItem(o, i, j));
  };

  const changed = order.some((id, i) => id !== media[i]?.id);
  const rows = Math.ceil(order.length / columns);

  return (
    <View style={{ gap: space.md }} testID="reorder-grid">
      <Txt size="sm" style={{ lineHeight: 19 }}>
        {t('photos.reorderHint')}
      </Txt>
      <View style={{ height: rows * size }} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
        {size
          ? order.map((id, index) => (
              <DragTile
                key={id}
                media={byId.get(id)!}
                index={index}
                total={order.length}
                size={size}
                position={pos(id)}
                lifted={dragging === id}
                onLift={() => {
                  haptic.select();
                  setDragging(id);
                }}
                onMoveTo={(x, y) => {
                  const to = slotAt(x + size / 2, y + size / 2, size, columns, orderRef.current.length);
                  const from = orderRef.current.indexOf(id);
                  if (to !== from) {
                    haptic.select();
                    setOrder((o) => moveItem(o, o.indexOf(id), to));
                  }
                }}
                onDrop={() => setDragging(null)}
                onMoveBy={(by) => moveBy(id, by)}
              />
            ))
          : null}
      </View>
      <View style={styles.actions}>
        <Button kind="secondary" label={t('common.cancel')} onPress={onCancel} testID="reorder-cancel" />
        <Button label={t('photos.saveOrder')} disabled={!changed} onPress={() => onSave(order)} testID="reorder-save" />
      </View>
    </View>
  );
}

const DragTile = memo(function DragTile({
  media,
  index,
  total,
  size,
  position,
  lifted,
  onLift,
  onMoveTo,
  onDrop,
  onMoveBy,
}: {
  media: Media;
  index: number;
  total: number;
  size: number;
  position: Animated.ValueXY;
  lifted: boolean;
  onLift: () => void;
  onMoveTo: (x: number, y: number) => void;
  onDrop: () => void;
  onMoveBy: (by: -1 | 1) => void;
}) {
  const { t } = useTranslation();
  // Handlers change every render; the responder is created once and reads the latest ones.
  const latest = useRef({ onLift, onMoveTo, onDrop });
  latest.current = { onLift, onMoveTo, onDrop };
  const start = useRef({ x: 0, y: 0 });
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        // While a tile is held, the page must not scroll away under the finger.
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          position.stopAnimation((v) => (start.current = v));
          latest.current.onLift();
        },
        onPanResponderMove: (_e, g) => {
          const x = start.current.x + g.dx;
          const y = start.current.y + g.dy;
          position.setValue({ x, y });
          latest.current.onMoveTo(x, y);
        },
        onPanResponderRelease: () => latest.current.onDrop(),
        onPanResponderTerminate: () => latest.current.onDrop(),
      }),
    [position],
  );
  const url = thumbUrl(media, size, size);
  return (
    <Animated.View
      {...responder.panHandlers}
      testID={`drag-${media.id}`}
      accessible
      accessibilityLabel={t('photos.reorderItem', { kind: t(media.type === 'video' ? 'photos.video' : 'photos.photo'), n: index + 1, total })}
      accessibilityActions={[
        { name: 'moveEarlier', label: t('photos.moveEarlier') },
        { name: 'moveLater', label: t('photos.moveLater') },
      ]}
      onAccessibilityAction={(e) => onMoveBy(e.nativeEvent.actionName === 'moveEarlier' ? -1 : 1)}
      style={[
        styles.cell,
        { width: size, height: size, transform: position.getTranslateTransform(), zIndex: lifted ? 10 : 1 },
        lifted && styles.lifted,
      ]}
    >
      <View style={styles.tile}>
        {url ? <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" recyclingKey={media.id} /> : null}
        <View style={styles.badge}>
          <Txt size="xs" variant="bold" color={c.white}>
            {index + 1}
          </Txt>
        </View>
        {media.type === 'video' ? (
          <View style={styles.video}>
            <Icon name="play" size={14} color={c.white} />
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  cell: { position: 'absolute', left: 0, top: 0, padding: GAP / 2 },
  lifted: { opacity: 0.92, elevation: 8, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  tile: { flex: 1, borderRadius: radius.md, overflow: 'hidden', backgroundColor: c.lavender, borderWidth: 2, borderColor: c.royal },
  badge: { position: 'absolute', left: 4, top: 4, minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 5, backgroundColor: c.royal, alignItems: 'center', justifyContent: 'center' },
  video: { position: 'absolute', right: 4, bottom: 4, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(35,38,47,0.7)', alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: space.sm, justifyContent: 'flex-end' },
});
