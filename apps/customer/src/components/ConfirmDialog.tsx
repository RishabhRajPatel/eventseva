// Confirm before anything that cannot be undone or costs money (UX.md §4). The title is a question
// naming the thing, the body says what will happen (with numbers), and the destructive button names
// the action. The other button says "Keep …" or "Go back"; never "OK".
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { errorText } from '../lib/errors';
import { c, radius, space } from '../lib/theme';
import { AppText } from './AppText';
import { Button, type PressResult } from './Button';
import { Icon } from './Icon';

export interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  body?: string;
  /** Names the action: "Log out", "Yes, cancel booking". */
  confirmLabel: string;
  /** "Keep booking", "Go back". */
  cancelLabel?: string;
  /** Red confirm button and a warning icon. */
  destructive?: boolean;
  /** Shown next to the spinner while the action runs. */
  busyLabel?: string;
  /** Extra content between the body and the buttons (a reason field, a refund box). */
  children?: ReactNode;
  /** Error from the last attempt, shown above the buttons. */
  error?: string | null;
  onConfirm: () => PressResult;
  onCancel: () => void;
}

export function ConfirmDialog({
  visible,
  title,
  body,
  confirmLabel,
  cancelLabel,
  destructive,
  busyLabel,
  children,
  error,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} accessibilityRole="button" accessibilityLabel={cancelLabel ?? t('common.goBack')} />
        <View style={styles.card} accessibilityViewIsModal>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" bounces={false}>
            {destructive ? (
              <View style={styles.iconCircle}>
                <Icon name="alert" size={24} color={c.danger} />
              </View>
            ) : null}
            <AppText variant="display" size="xl" accessibilityRole="header">
              {title}
            </AppText>
            {body ? <AppText size="md">{body}</AppText> : null}
            {children}
            {error ? (
              <AppText size="sm" color={c.danger} accessibilityLiveRegion="assertive">
                {error}
              </AppText>
            ) : null}
            <View style={styles.buttons}>
              <Button label={confirmLabel} variant={destructive ? 'danger' : 'primary'} onPress={onConfirm} loadingLabel={busyLabel} />
              <Button label={cancelLabel ?? t('common.goBack')} variant="outline" onPress={onCancel} />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  busyLabel?: string;
  /** Runs while the dialog shows a busy button; if it throws, the dialog stays open with the error. */
  action?: () => Promise<unknown>;
}

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };
type Confirm = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Confirm | null>(null);

/** One dialog for the whole app; screens ask with `await confirm({...})`. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<Pending | null>(null);

  const close = useCallback((ok: boolean) => {
    current.current?.resolve(ok);
    current.current = null;
    setPending(null);
    setError(null);
  }, []);

  const confirm = useCallback<Confirm>(
    (options) =>
      new Promise<boolean>((resolve) => {
        current.current?.resolve(false);
        const next = { ...options, resolve };
        current.current = next;
        setError(null);
        setPending(next);
      }),
    [],
  );

  const onConfirm = useCallback(async () => {
    const p = current.current;
    if (!p) return;
    if (!p.action) return close(true);
    setError(null);
    try {
      await p.action();
      close(true);
    } catch (e) {
      setError(errorText(t, e));
      throw e;
    }
  }, [close, t]);

  const value = useMemo(() => confirm, [confirm]);
  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {pending ? (
        <ConfirmDialog
          visible
          title={pending.title}
          body={pending.body}
          confirmLabel={pending.confirmLabel}
          cancelLabel={pending.cancelLabel}
          destructive={pending.destructive}
          busyLabel={pending.busyLabel}
          error={error}
          onConfirm={onConfirm}
          onCancel={() => close(false)}
        />
      ) : null}
    </ConfirmContext.Provider>
  );
}

/** `const confirm = useConfirm(); if (await confirm({...})) …`. Without a provider every question is answered "no". */
export function useConfirm(): Confirm {
  return useContext(ConfirmContext) ?? (async () => false);
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'rgba(35,38,47,0.55)', alignItems: 'center', justifyContent: 'center', padding: space.xl },
  card: { width: '100%', maxWidth: 440, maxHeight: '90%', backgroundColor: c.white, borderRadius: radius.xl, overflow: 'hidden' },
  content: { padding: space.xxl, gap: space.md },
  iconCircle: { width: 48, height: 48, borderRadius: 24, backgroundColor: c.dangerBg, alignItems: 'center', justifyContent: 'center' },
  buttons: { gap: space.sm, marginTop: space.sm },
});
