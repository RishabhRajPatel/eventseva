import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { ApiError } from '@eventseva/app-shared';
import i18n from '../i18n';
import { Button } from '../components/Button';
import { ChoiceChip } from '../components/Chip';
import { errorText, KNOWN_CODES } from '../lib/errors';
import { reportResult, offlineStore } from '../lib/network';
import { toast } from '../lib/toast';
import { renderScreen } from './render';

declare const __dirname: string;

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(async () => undefined),
  impactAsync: jest.fn(async () => undefined),
  notificationAsync: jest.fn(async () => undefined),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.useRealTimers());

describe('toast', () => {
  it('shows for 3 s with a success haptic, then goes', async () => {
    jest.useFakeTimers();
    await renderScreen(<></>);
    await act(async () => {
      toast.success('Saved');
    });
    expect(screen.getByTestId('toast')).toHaveTextContent('Saved');
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('success');
    await act(async () => {
      jest.advanceTimersByTime(3100);
    });
    expect(screen.queryByTestId('toast')).toBeNull();
  });

  it('runs its action (Undo) once and closes', async () => {
    const undo = jest.fn();
    await renderScreen(<></>);
    await act(async () => {
      toast.info('Photo deleted', { action: { label: 'Undo', onPress: undo } });
    });
    await fireEvent.press(screen.getByTestId('toast-action'));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('toast')).toBeNull();
  });

  it('a new toast replaces the old one', async () => {
    await renderScreen(<></>);
    await act(async () => {
      toast.success('One');
      toast.error('Two');
    });
    expect(screen.getAllByTestId('toast')).toHaveLength(1);
    expect(screen.getByTestId('toast')).toHaveTextContent('Two');
    expect(Haptics.notificationAsync).toHaveBeenLastCalledWith('error');
  });
});

describe('selection state', () => {
  it('a selected chip has the ✓, is announced as selected, and tapping gives a light haptic', async () => {
    const onPress = jest.fn();
    await render(
      <>
        <ChoiceChip testID="on" label="DJ" selected onPress={onPress} />
        <ChoiceChip testID="off" label="Lights" onPress={onPress} />
        <ChoiceChip testID="no" label="Tent" disabled disabledHint="Booked" onPress={onPress} />
      </>,
    );
    const on = screen.getByTestId('on');
    expect(on.props.accessibilityRole).toBe('radio');
    expect(on.props.accessibilityState).toMatchObject({ selected: true });
    expect(on.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ backgroundColor: '#d9b8ff', borderWidth: 2, borderColor: '#263baa' })]));
    expect(screen.getByTestId('off').props.accessibilityState).toMatchObject({ selected: false });
    await fireEvent.press(screen.getByTestId('off'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(Haptics.selectionAsync).toHaveBeenCalled();
    // Disabled: no action, and the reason is given.
    await fireEvent.press(screen.getByTestId('no'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getByText('· Booked')).toBeTruthy();
  });
});

describe('Button double-submit guard', () => {
  it('a second tap before the screen re-renders is dropped', async () => {
    const onPress = jest.fn();
    await render(<Button testID="b" label="Save" onPress={onPress} />);
    await fireEvent.press(screen.getByTestId('b'));
    await fireEvent.press(screen.getByTestId('b'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
  });

  it('stays busy and disabled until the returned promise settles', async () => {
    let finish!: () => void;
    const onPress = jest.fn(() => new Promise<void>((r) => (finish = r)));
    await render(<Button testID="b" label="Save" onPress={onPress} />);
    await fireEvent.press(screen.getByTestId('b'));
    expect(screen.getByTestId('b').props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    expect(screen.getByTestId('b-spinner')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('b'));
    expect(onPress).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(screen.getByTestId('b').props.accessibilityState).toMatchObject({ busy: false, disabled: false });
  });

  it('ignores presses while loading or disabled', async () => {
    const onPress = jest.fn();
    await render(
      <>
        <Button testID="l" label="A" loading onPress={onPress} />
        <Button testID="d" label="B" disabled onPress={onPress} />
      </>,
    );
    await fireEvent.press(screen.getByTestId('l'));
    await fireEvent.press(screen.getByTestId('d'));
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('offline banner state', () => {
  it('turns on with a NETWORK error and off with the next success', () => {
    reportResult(new ApiError(0, 'NETWORK', 'No internet'));
    expect(offlineStore.get()).toBe(true);
    reportResult(new ApiError(409, 'SLOT_TAKEN', 'x'));
    expect(offlineStore.get()).toBe(true);
    reportResult(null);
    expect(offlineStore.get()).toBe(false);
  });
});

describe('error messages', () => {
  // Codes in docs/API.md that are not API errors (env vars, HTTP verbs, admin-only, a constant).
  const NOT_FOR_THIS_APP = new Set(['CATEGORY_ICONS', 'CLOUDINARY_URL', 'COUNTED_UNITS', 'PATCH', 'POST', 'PORT', 'REVIEW_OTP', 'REVIEW_PHONE', 'TRUST_PROXY', 'ADMIN_LOCKED', 'ADMIN_LOGIN_FAILED', 'CATEGORY_EXISTS', 'LAST_CITY',
    // Customer app and admin panel only.
    'TOO_LATE_TO_BOOK', 'TOO_MANY_OPEN_REQUESTS', 'QUANTITY_OUT_OF_RANGE', 'NO_VENDOR_PAYOUT',
    'TOO_SOON', 'DURATION_TOO_SHORT', 'DURATION_TOO_LONG', 'OUTSIDE_WORKING_HOURS', 'OUTSIDE_EVENT_DATES', 'CHARGE_ALREADY_ANSWERED', 'NOTHING_TO_PAY',
    'USE_SLOT_BOOKING', 'SERVICE_NOT_CONFIGURED', 'ADDON_NOT_FOUND', 'ROUTE_REQUIRED', 'MODE_NOT_OFFERED', 'VEHICLE_NOT_AVAILABLE', 'NO_DRIVER',
    'LICENCE_REQUIRED', 'TOO_YOUNG', 'BUNDLE_NOT_FOUND', 'BUNDLE_INCOMPLETE', 'CHANGE_PENDING', 'CHANGE_NOT_SUPPORTED', 'DOCUMENTS_MISSING',
    // Server settings and values, not error codes.
    'BANK_DETAILS_KEY', 'PROFORMA', 'CASH_DUES_LIMIT_PAISE']);
  // Read the API docs straight from the repo (no Node types in this app, hence the typed require).
  const { readFileSync } = jest.requireActual<{ readFileSync: (path: string, enc: string) => string }>('fs');
  const doc = readFileSync(`${__dirname}/../../../../docs/API.md`, 'utf8');
  const codes = [...new Set([...doc.matchAll(/`([A-Z][A-Z_]{3,})`/g)].map((m) => m[1]))].filter((c) => !NOT_FOR_THIS_APP.has(c));

  it('every error code in docs/API.md has its own translated sentence', () => {
    expect(codes.length).toBeGreaterThan(40);
    expect(codes.filter((c) => !KNOWN_CODES.includes(c))).toEqual([]);
  });

  it.each(['en', 'hi'])('%s: never shows a raw code', async (lang) => {
    await i18n.changeLanguage(lang);
    const t = i18n.t.bind(i18n);
    for (const code of codes) {
      const text = errorText(t, new ApiError(400, code, 'RAW SERVER TEXT', { attemptsLeft: 2, retryAfterSec: 30, bookings: 2 }));
      expect(text).not.toMatch(/RAW SERVER TEXT|^(errors|upload)\.\w+$/);
      expect(text.length).toBeGreaterThan(10);
    }
    expect(errorText(t, new ApiError(500, 'HTTP_500', 'Internal'))).not.toMatch(/500|Internal/);
    await i18n.changeLanguage('en');
  });

  it('explains open bookings with the count', () => {
    expect(errorText(i18n.t.bind(i18n), new ApiError(409, 'ACCOUNT_HAS_ACTIVE_BOOKINGS', 'x', { bookings: 2 }))).toBe('You still have 2 open bookings. Finish or cancel them first, then delete your account.');
  });
});
