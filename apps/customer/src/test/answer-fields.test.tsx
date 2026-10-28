import { screen, userEvent, waitFor } from '@testing-library/react-native';
import { useState } from 'react';
import type { FieldDef } from '@eventseva/app-shared';
import { AnswerField } from '../components/EngineFields';
import { LicencePhotoError, pickAndUploadAnswerPhoto } from '../lib/licencePhoto';
import { renderApp } from './render';

jest.mock('../lib/api', () => require('./mockApi').mockApiModule());
jest.mock('../lib/licencePhoto', () => {
  const actual = jest.requireActual('../lib/licencePhoto');
  return { ...actual, pickAndUploadAnswerPhoto: jest.fn() };
});

const pick = pickAndUploadAnswerPhoto as jest.Mock;
const seen: unknown[] = [];

function Harness({ field }: { field: FieldDef }) {
  const [value, setValue] = useState<unknown>(undefined);
  return <AnswerField field={field} value={value} onChange={(v) => (seen.push(v), setValue(v))} />;
}
const show = (field: FieldDef) => renderApp({ index: () => <Harness field={field} /> }, '/');

beforeEach(() => {
  jest.clearAllMocks();
  seen.length = 0;
});

test('a time question offers half-hour times to tap', async () => {
  const user = userEvent.setup();
  await show({ key: 'arrive_by', label: { en: 'Arrive by', hi: 'कब तक पहुँचें' }, type: 'time', help: { en: 'India time', hi: 'भारत का समय' } });
  expect(screen.getByText('India time')).toBeOnTheScreen();
  await user.press(screen.getByRole('radio', { name: '5:30 pm' }));
  expect(seen.at(-1)).toBe('17:30');
});

test('a photo question uploads privately, can be changed or removed, and explains failures', async () => {
  const user = userEvent.setup();
  await show({ key: 'venue_photo', label: { en: 'Venue photo', hi: 'जगह की फ़ोटो' }, type: 'photo', required: true });
  pick.mockRejectedValueOnce(new LicencePhotoError('FILE_TOO_BIG'));
  await user.press(screen.getByRole('button', { name: 'Attach a photo' }));
  expect(await screen.findByText('This photo is too big. Pick a smaller one.')).toBeOnTheScreen();
  const photo = { publicId: 'eventseva/customers/u1/answers/a', version: 1, signature: 'sig', format: 'jpg' };
  pick.mockResolvedValueOnce(photo);
  await user.press(screen.getByRole('button', { name: 'Attach a photo' }));
  await waitFor(() => expect(seen.at(-1)).toEqual(photo));
  expect(screen.getByText('Photo attached. Only you and the vendor can open it.')).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Remove the photo' }));
  expect(seen.at(-1)).toBeUndefined();
  // Closing the picker changes nothing.
  pick.mockResolvedValueOnce(null);
  await user.press(screen.getByRole('button', { name: 'Attach a photo' }));
  expect(seen).toHaveLength(2);
});
