// Haptic feedback (UX.md §2–3). Never throws: phones without a vibration motor, web and tests just skip it.
import * as Haptics from 'expo-haptics';

function run(fn: () => Promise<void>) {
  try {
    void fn().catch(() => undefined);
  } catch {
    // Native module missing (web, some tests): no feedback.
  }
}

export const haptic = {
  /** Light tap when something is selected or unselected. */
  select: () => run(() => Haptics.selectionAsync()),
  success: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  error: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};
