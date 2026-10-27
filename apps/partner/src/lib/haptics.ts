// Small, consistent haptics (UX.md §2–3). Haptics are a nicety: never let them throw.
import * as Haptics from 'expo-haptics';

function safe(run: () => Promise<void>) {
  try {
    void run().catch(() => undefined);
  } catch {
    // No haptics engine (web, tests, old phones).
  }
}

export const haptic = {
  /** Selecting or unselecting a chip, slot, plan or photo. */
  select: () => safe(() => Haptics.selectionAsync()),
  /** Pressing a button. */
  tap: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  success: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};
