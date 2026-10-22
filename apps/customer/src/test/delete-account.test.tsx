import { screen, userEvent, waitFor } from '@testing-library/react-native';
import { ApiError } from '@eventseva/app-shared';
import DeleteAccountScreen from '../app/delete-account';
import { api } from '../lib/api';
import { renderApp } from './render';

jest.mock('../lib/api', () => require('./mockApi').mockApiModule());
const mockSignOut = jest.fn();
jest.mock('../lib/session', () => ({ useSession: () => ({ signOut: mockSignOut }) }));

const mockedApi = api as unknown as Record<string, jest.Mock>;
beforeEach(() => jest.clearAllMocks());

test('delete account needs DELETE typed, then deletes and signs out', async () => {
  mockedApi.deleteAccount.mockResolvedValue(undefined);
  const user = userEvent.setup();
  await renderApp({ 'delete-account': DeleteAccountScreen }, '/delete-account');

  await user.press(screen.getByRole('button', { name: 'Delete my account' }));
  expect(mockedApi.deleteAccount).not.toHaveBeenCalled();

  await user.type(screen.getByLabelText('Type DELETE to confirm'), 'delete');
  await user.press(screen.getByRole('button', { name: 'Delete my account' }));
  await waitFor(() => expect(mockedApi.deleteAccount).toHaveBeenCalled());
  await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
});

test('an open booking blocks deletion with the API message', async () => {
  mockedApi.deleteAccount.mockRejectedValue(
    new ApiError(409, 'ACCOUNT_HAS_ACTIVE_BOOKINGS', 'Finish or cancel your open bookings before deleting your account.', { bookings: 1 }),
  );
  const user = userEvent.setup();
  await renderApp({ 'delete-account': DeleteAccountScreen }, '/delete-account');
  await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
  await user.press(screen.getByRole('button', { name: 'Delete my account' }));
  expect(await screen.findByText(/open bookings/)).toBeOnTheScreen();
  expect(mockSignOut).not.toHaveBeenCalled();
});
