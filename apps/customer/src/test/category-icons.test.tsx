import { CATEGORY_ICONS } from '@eventseva/core';
import { categoryIcon } from '../components/Icon';

test('every icon an admin can pick has a drawing; unknown ones fall back to "other"', () => {
  for (const icon of CATEGORY_ICONS) expect(categoryIcon(icon)).toBe(icon);
  expect(categoryIcon('rocket')).toBe('other');
});
