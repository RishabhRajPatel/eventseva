// Shared feedback pieces (UX.md §2–5): toast with Undo, confirm dialog, selection state, the
// double-submit guard and skeletons.
import { useState } from 'react';
import { Text } from 'react-native';
import { act, render, renderHook, screen, userEvent, waitFor, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ChatListScreen from '../app/(tabs)/chat';
import { api } from '../lib/api';
import { Button, usePressGuard } from '../components/Button';
import { ConfirmDialog, ConfirmProvider, useConfirm } from '../components/ConfirmDialog';
import { Chip, ChoiceRow, OptionTile } from '../components/Form';
import { TOAST_ACTION_MS, TOAST_MS, ToastProvider, useToast } from '../components/Toast';
import { renderApp } from './render';
import '../i18n';

jest.mock('../lib/api', () => require('./mockApi').mockApiModule());
const mockedApi = api as unknown as Record<string, jest.Mock>;

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const wrap = (ui: React.ReactElement) =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ToastProvider>
        <ConfirmProvider>{ui}</ConfirmProvider>
      </ToastProvider>
    </SafeAreaProvider>,
  );

beforeEach(() => jest.clearAllMocks());

describe('toast', () => {
  function Demo({ onUndo }: { onUndo: () => void }) {
    const toast = useToast();
    return (
      <>
        <Button label="Save" onPress={() => toast.success('Saved')} />
        <Button label="Remove" onPress={() => toast.info('Removed from saved vendors', { action: { label: 'Undo', onPress: onUndo } })} />
      </>
    );
  }

  test('shows a success message in a live region and hides it after 3 s', async () => {
    jest.useFakeTimers();
    try {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      await wrap(<Demo onUndo={jest.fn()} />);
      await user.press(screen.getByRole('button', { name: 'Save' }));
      const toast = screen.getByTestId('toast');
      expect(within(toast).getByText('Saved')).toBeOnTheScreen();
      expect(toast).toHaveProp('accessibilityLiveRegion', 'polite');
      await act(async () => {
        jest.advanceTimersByTime(TOAST_MS - 100);
      });
      expect(screen.getByText('Saved')).toBeOnTheScreen();
      await act(async () => {
        jest.advanceTimersByTime(200);
      });
      expect(screen.queryByText('Saved')).not.toBeOnTheScreen();
    } finally {
      jest.useRealTimers();
    }
  });

  test('Undo runs the action once and closes the toast; an action toast stays 5 s', async () => {
    jest.useFakeTimers();
    try {
      const onUndo = jest.fn();
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      await wrap(<Demo onUndo={onUndo} />);
      await user.press(screen.getByRole('button', { name: 'Remove' }));
      await act(async () => {
        jest.advanceTimersByTime(TOAST_MS + 500);
      });
      expect(screen.getByText('Removed from saved vendors')).toBeOnTheScreen(); // longer than a plain toast
      await user.press(screen.getByRole('button', { name: 'Undo' }));
      expect(onUndo).toHaveBeenCalledTimes(1);
      expect(screen.queryByText('Removed from saved vendors')).not.toBeOnTheScreen();

      await user.press(screen.getByRole('button', { name: 'Remove' }));
      await act(async () => {
        jest.advanceTimersByTime(TOAST_ACTION_MS + 100);
      });
      expect(screen.queryByText('Removed from saved vendors')).not.toBeOnTheScreen();
      expect(onUndo).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('confirm dialog', () => {
  test('destructive: a question, what happens, a red button naming the action, and Keep', async () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    const user = userEvent.setup();
    await wrap(
      <ConfirmDialog
        visible
        destructive
        title="Delete this photo?"
        body="It is removed from your page for everyone."
        confirmLabel="Delete photo"
        cancelLabel="Keep photo"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByRole('header', { name: 'Delete this photo?' })).toBeOnTheScreen();
    expect(screen.getByText('It is removed from your page for everyone.')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'OK' })).not.toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Keep photo' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    await user.press(screen.getByRole('button', { name: 'Delete photo' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  test('useConfirm resolves false on cancel, and runs the action with a busy button on confirm', async () => {
    let finish!: () => void;
    const action = jest.fn(() => new Promise<void>((r) => (finish = r)));
    const results: boolean[] = [];
    function Demo() {
      const confirm = useConfirm();
      const ask = async () => {
        results.push(await confirm({ title: 'Log out of EventSeva?', confirmLabel: 'Log out', cancelLabel: 'Stay logged in', destructive: true, action }));
      };
      return <Button label="Open" onPress={() => void ask()} />;
    }
    const user = userEvent.setup();
    await wrap(<Demo />);

    await user.press(screen.getByRole('button', { name: 'Open' }));
    await user.press(screen.getByRole('button', { name: 'Stay logged in' }));
    await waitFor(() => expect(results).toEqual([false]));
    expect(action).not.toHaveBeenCalled();
    expect(screen.queryByText('Log out of EventSeva?')).not.toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Open' }));
    await user.press(screen.getByRole('button', { name: 'Log out' }));
    expect(action).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Log out' })).toBeBusy();
    expect(screen.getByRole('button', { name: 'Log out' })).toBeDisabled();
    await act(async () => finish());
    await waitFor(() => expect(results).toEqual([false, true]));
    expect(screen.queryByText('Log out of EventSeva?')).not.toBeOnTheScreen();
  });
});

describe('selection', () => {
  function Picker() {
    const [slot, setSlot] = useState('day');
    const [veg, setVeg] = useState(false);
    const [event, setEvent] = useState('e1');
    return (
      <>
        <OptionTile label="Day" sublabel="10–4" selected={slot === 'day'} onPress={() => setSlot('day')} />
        <OptionTile label="Night" sublabel="6–11" selected={slot === 'night'} onPress={() => setSlot('night')} />
        <OptionTile label="Full day" sublabel="Booked" selected={false} disabled onPress={() => setSlot('full')} />
        <Chip role="checkbox" label="Veg only" selected={veg} onPress={() => setVeg((v) => !v)} />
        <ChoiceRow label="Rahul's Wedding" selected={event === 'e1'} onPress={() => setEvent('e1')} />
        <ChoiceRow label="New event" selected={event === 'new'} onPress={() => setEvent('new')} />
      </>
    );
  }

  test('selected items say so to screen readers and show a ✓, never colour alone', async () => {
    const user = userEvent.setup();
    await wrap(<Picker />);
    const day = screen.getByRole('radio', { name: 'Day, 10–4' });
    const night = screen.getByRole('radio', { name: 'Night, 6–11' });
    expect(day).toBeSelected();
    expect(day).toBeChecked();
    expect(within(day).getByTestId('selected-mark')).toBeOnTheScreen();
    expect(night).not.toBeSelected();
    expect(within(night).queryByTestId('selected-mark')).not.toBeOnTheScreen();

    await user.press(night);
    expect(screen.getByRole('radio', { name: 'Night, 6–11' })).toBeSelected();
    expect(within(screen.getByRole('radio', { name: 'Night, 6–11' })).getByTestId('selected-mark')).toBeOnTheScreen();
    expect(within(screen.getByRole('radio', { name: 'Day, 10–4' })).queryByTestId('selected-mark')).not.toBeOnTheScreen();

    // Disabled says why in its label.
    expect(screen.getByRole('radio', { name: 'Full day, Booked' })).toBeDisabled();

    const veg = screen.getByRole('checkbox', { name: 'Veg only' });
    expect(veg).not.toBeChecked();
    await user.press(veg);
    expect(screen.getByRole('checkbox', { name: 'Veg only' })).toBeChecked();
    expect(within(screen.getByRole('checkbox', { name: 'Veg only' })).getByTestId('selected-mark')).toBeOnTheScreen();

    await user.press(screen.getByRole('radio', { name: 'New event' }));
    expect(screen.getByRole('radio', { name: 'New event' })).toBeSelected();
    expect(screen.getByRole('radio', { name: "Rahul's Wedding" })).not.toBeSelected();
  });
});

describe('buttons', () => {
  test('double submit: pressing twice while the request runs sends once; busy until it finishes', async () => {
    let finish!: () => void;
    const send = jest.fn(() => new Promise<void>((r) => (finish = r)));
    const user = userEvent.setup();
 await wrap(<Button label="Send request" onPress={send} loadingLabel="Sending request…" />);

    const button = screen.getByRole('button', { name: 'Send request' });
    await user.press(button);
    await user.press(button);
    expect(send).toHaveBeenCalledTimes(1);
    expect(button).toBeBusy();
    expect(button).toBeDisabled();
    expect(screen.getByText('Sending request…')).toBeOnTheScreen();

    await act(async () => finish());
    expect(screen.getByRole('button', { name: 'Send request' })).not.toBeBusy();
    expect(screen.getByRole('button', { name: 'Send request' })).toBeEnabled();
    await user.press(screen.getByRole('button', { name: 'Send request' }));
    expect(send).toHaveBeenCalledTimes(2);
  });

  test('the guard is inside the handler: two taps in the same tick, before a re-render, still send once', async () => {
    let finish!: () => void;
    const send = jest.fn(() => new Promise<void>((r) => (finish = r)));
    const { result } = await renderHook(() => usePressGuard(send));
    await act(async () => {
      result.current.press();
      result.current.press();
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe(true);
    await act(async () => finish());
    expect(result.current.busy).toBe(false);
  });
});

describe('skeletons', () => {
  test('lists show a skeleton shaped like the content while loading, then the content', async () => {
    let resolve!: (v: unknown) => void;
    mockedApi.conversations.mockReturnValue(new Promise((r) => (resolve = r)));
    await renderApp({ chat: ChatListScreen }, '/chat');
    expect(screen.getByTestId('skeleton')).toBeBusy();
    expect(screen.getByRole('progressbar', { name: 'Loading' })).toBeOnTheScreen();

    await act(async () =>
      resolve({
        items: [{ id: 'c1', vendorId: 'v9', vendorName: 'Beat Box DJ', customerName: 'Rahul', lastMessage: 'See you', lastMessageAt: null, unreadCount: 0, hasBooking: false }],
      }),
    );
    expect(await screen.findByText('Beat Box DJ')).toBeOnTheScreen();
    expect(screen.queryByTestId('skeleton')).not.toBeOnTheScreen();
  });

  test('an empty list shows an icon, one sentence and one action', async () => {
    mockedApi.conversations.mockResolvedValue({ items: [] });
    await renderApp({ chat: ChatListScreen, search: () => <Text>SEARCH</Text> }, '/chat');
    expect(await screen.findByText('No chats yet')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Find vendors' })).toBeOnTheScreen();
  });
});
