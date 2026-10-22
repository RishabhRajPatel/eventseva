import { act, screen, userEvent, waitFor } from '@testing-library/react-native';
import { ApiError } from '@eventseva/app-shared';
import LoginScreen from '../app/login';
import OtpScreen from '../app/otp';
import { api } from '../lib/api';
import { renderApp } from './render';

jest.mock('../lib/api', () => require('./mockApi').mockApiModule());
const mockSignIn = jest.fn();
jest.mock('../lib/session', () => ({ useSession: () => ({ signIn: mockSignIn }) }));

const mockedApi = api as unknown as Record<string, jest.Mock>;

beforeEach(() => jest.clearAllMocks());

test('login: a valid number sends an OTP and opens the OTP screen', async () => {
  mockedApi.sendOtp.mockResolvedValue({ sent: true, expiresInSec: 300, resendAfterSec: 30 });
  const user = userEvent.setup();
  const router = await renderApp({ login: LoginScreen, otp: OtpScreen }, '/login');

  expect(screen.getByText('Enter your phone number')).toBeOnTheScreen();
  await user.type(screen.getByLabelText('Mobile number'), '98765 43210');
  await user.press(screen.getByRole('button', { name: 'Send OTP' }));

  expect(mockedApi.sendOtp).toHaveBeenCalledWith('9876543210');
  await waitFor(() => expect(router.getPathname()).toBe('/otp'));
  expect(await screen.findByText('We sent a 6-digit code to +91 98XXX XXX10.', { exact: false })).toBeOnTheScreen();
  expect(screen.getByText('Resend in 00:30')).toBeOnTheScreen();
});

test('login: an invalid number is caught before calling the API', async () => {
  const user = userEvent.setup();
  await renderApp({ login: LoginScreen }, '/login');
  await user.type(screen.getByLabelText('Mobile number'), '1234567890');
  await user.press(screen.getByRole('button', { name: 'Send OTP' }));
  expect(screen.getByText('Enter a valid 10-digit Indian mobile number.')).toBeOnTheScreen();
  expect(mockedApi.sendOtp).not.toHaveBeenCalled();
});

test('otp: a wrong code shows the attempts left; success signs in as the customer app', async () => {
  const result = { isNewUser: true, user: { id: 'u1', phone: '+919876543210', name: null, language: 'en' } };
  mockedApi.verifyOtp
    .mockRejectedValueOnce(new ApiError(400, 'OTP_INVALID', 'Wrong code', { attemptsLeft: 3 }))
    .mockResolvedValueOnce(result);
  const user = userEvent.setup();
  await renderApp({ otp: OtpScreen }, '/otp?phone=9876543210&resendAfter=30');

  await user.type(screen.getByLabelText('6-digit OTP'), '111111');
  expect(await screen.findByText('Wrong code. 3 tries left.')).toBeOnTheScreen();
  expect(mockedApi.verifyOtp).toHaveBeenCalledWith('9876543210', '111111');

  await user.type(screen.getByLabelText('6-digit OTP'), '482715');
  await waitFor(() => expect(mockSignIn).toHaveBeenCalledWith(result));
});

test('otp: a locked login shows the lock message and disables Verify', async () => {
  mockedApi.verifyOtp.mockRejectedValue(new ApiError(429, 'OTP_LOCKED', 'Locked'));
  const user = userEvent.setup();
  await renderApp({ otp: OtpScreen }, '/otp?phone=9876543210');
  await user.type(screen.getByLabelText('6-digit OTP'), '000000');
  expect(await screen.findByText('Too many wrong codes. For your safety, login is locked for 15 minutes.')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Verify' })).toBeDisabled();
});

test('otp: the resend timer counts down, then Resend asks for a new code', async () => {
  jest.useFakeTimers();
  mockedApi.sendOtp.mockResolvedValue({ sent: true, expiresInSec: 300, resendAfterSec: 30 });
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  await renderApp({ otp: OtpScreen }, '/otp?phone=9876543210&resendAfter=2');
  expect(screen.getByText('Resend in 00:02')).toBeOnTheScreen();
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
  await user.press(screen.getByRole('button', { name: 'Resend OTP' }));
  expect(mockedApi.sendOtp).toHaveBeenCalledWith('9876543210');
  expect(await screen.findByText('Resend in 00:30')).toBeOnTheScreen();
  jest.useRealTimers();
});
