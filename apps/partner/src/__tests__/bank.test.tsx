import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { api } from '../lib/api';
import { maskAccount, validateBank } from '../lib/bank';
import BankScreen from '../app/bank';
import DeleteAccountScreen from '../app/delete-account';
import { renderScreen } from './render';

jest.mock('expo-router', () => require('./routerMock').expoRouterMock);
jest.mock('../lib/api', () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), put: jest.fn(), delete: jest.fn() },
  onSessionEnded: jest.fn(),
}));
const mockSignOut = jest.fn();
jest.mock('../lib/session', () => ({ useSession: () => ({ signOut: mockSignOut }) }));

const get = api.get as jest.Mock;
const put = api.put as jest.Mock;
const del = api.delete as jest.Mock;

const form = { holderName: 'Raj Kumar', accountNumber: '123456789012', confirmAccountNumber: '123456789012', ifsc: 'sbin0001234', upiId: '' };

describe('bank details rules', () => {
  it('accepts a correct form and flags each mistake', () => {
    expect(validateBank(form)).toEqual({});
    expect(validateBank({ ...form, accountNumber: '1234' })).toEqual({ accountNumber: 'account' });
    expect(validateBank({ ...form, confirmAccountNumber: '123456789013' })).toEqual({ confirmAccountNumber: 'mismatch' });
    expect(validateBank({ ...form, ifsc: 'SBIN1234567' })).toEqual({ ifsc: 'ifsc' });
    expect(validateBank({ ...form, upiId: 'not-upi' })).toEqual({ upiId: 'upi' });
    expect(validateBank({ ...form, holderName: ' ' })).toEqual({ holderName: 'required' });
    expect(maskAccount('9012')).toBe('XXXX XXXX 9012');
  });
});

describe('bank screen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does not save until the form is right, then sends digits only and IFSC in capitals', async () => {
    get.mockResolvedValue({ account: null });
    put.mockResolvedValue({ account: { holderName: 'Raj Kumar', accountLast4: '9012', ifsc: 'SBIN0001234', upiId: null, status: 'pending', rejectReason: null, updatedAt: '' } });
    await renderScreen(<BankScreen />);

    await fireEvent.press(screen.getByTestId('save-bank'));
    expect(await screen.findByText('Enter the account holder name.')).toBeTruthy();
    expect(put).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByTestId('holder'), 'Raj Kumar');
    await fireEvent.changeText(screen.getByTestId('account'), '1234 5678 9012');
    await fireEvent.changeText(screen.getByTestId('confirm-account'), '123456789012');
    await fireEvent.changeText(screen.getByTestId('ifsc'), 'sbin0001234');
    await fireEvent.press(screen.getByTestId('save-bank'));
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith('/v1/partner/bank-account', { holderName: 'Raj Kumar', accountNumber: '123456789012', ifsc: 'SBIN0001234', upiId: undefined }),
    );
  });
});

describe('delete account screen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('needs DELETE typed, then deletes and signs out', async () => {
    del.mockResolvedValue(undefined);
    await renderScreen(<DeleteAccountScreen />);
    await fireEvent.press(screen.getByTestId('delete-confirm'));
    expect(del).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByTestId('confirm-delete'), 'delete');
    await fireEvent.press(screen.getByTestId('delete-confirm'));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/v1/me', { confirm: 'DELETE' }));
    await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
  });
});
