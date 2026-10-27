import { fireEvent, screen } from '@testing-library/react-native';
import type { Media } from '@eventseva/app-shared';
import { moveItem, ReorderGrid, slotAt } from '../components/ReorderGrid';
import { renderScreen } from './render';

const tile = (id: string): Media => ({
  id, type: 'photo', publicId: `p/${id}`, width: 1000, height: 1000, blurhash: null,
  durationSec: null, isCover: false, coverCrop: null, sortOrder: 0, status: 'approved',
});

describe('drag to re-order', () => {
  it('moves an item to a new place', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveItem(['a', 'b'], 0, 9)).toEqual(['b', 'a']);
  });

  it('finds the slot under the finger, clamped to the grid', () => {
    // 3 columns of 100 px, 7 tiles.
    expect(slotAt(150, 50, 100, 3, 7)).toBe(1);
    expect(slotAt(50, 150, 100, 3, 7)).toBe(3);
    expect(slotAt(-40, -40, 100, 3, 7)).toBe(0);
    expect(slotAt(290, 990, 100, 3, 7)).toBe(6);
  });

  it('screen readers can move tiles; nothing is saved until Save order', async () => {
    const onSave = jest.fn();
    await renderScreen(<ReorderGrid media={[tile('a'), tile('b'), tile('c')]} columns={3} onSave={onSave} onCancel={jest.fn()} />);
    await fireEvent(screen.getByTestId('reorder-grid').children[1] as never, 'layout', { nativeEvent: { layout: { width: 300, height: 100 } } });
    expect(screen.getByTestId('reorder-save').props.accessibilityState?.disabled).toBe(true);
    await fireEvent(screen.getByTestId('drag-a'), 'accessibilityAction', { nativeEvent: { actionName: 'moveLater' } });
    expect(onSave).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('reorder-save'));
    expect(onSave).toHaveBeenCalledWith(['b', 'a', 'c']);
  });
});
