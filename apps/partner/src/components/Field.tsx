import { forwardRef, useState } from 'react';
import type { TextInputInstance } from 'react-native';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { c, radius, space, text } from '../lib/theme';
import { Txt, useFonts } from './Txt';

export interface FieldProps extends TextInputProps {
  label?: string;
  hint?: string;
  error?: string | null;
  /** Shown inside the box before the input, e.g. "+91" or "₹". */
  prefix?: string;
}

export const Field = forwardRef<TextInputInstance, FieldProps>(function Field({ label, hint, error, prefix, multiline, style, onFocus, onBlur, ...rest }, ref) {
  const f = useFonts();
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.wrap}>
      {label ? (
        <Txt variant="bold" size="sm">
          {label}
        </Txt>
      ) : null}
      <View
        style={[
          styles.box,
          multiline ? styles.multi : null,
          { borderColor: error ? c.danger : focused ? c.royal : c.lilac, borderWidth: focused ? 2 : 1.5 },
        ]}
      >
        {prefix ? (
          <View style={styles.prefix}>
            <Txt variant="bold" size="lg">
              {prefix}
            </Txt>
          </View>
        ) : null}
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          placeholderTextColor={c.muted}
          multiline={multiline}
          textAlignVertical={multiline ? 'top' : 'center'}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[styles.input, { fontFamily: f.body }, multiline ? styles.inputMulti : null, style]}
          {...rest}
        />
      </View>
      {error ? (
        <Txt size="sm" color={c.danger}>
          {error}
        </Txt>
      ) : hint ? (
        <Txt size="xs" color={c.textMuted}>
          {hint}
        </Txt>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  box: { minHeight: 56, borderRadius: radius.md, backgroundColor: c.white, flexDirection: 'row', alignItems: 'center', overflow: 'hidden' },
  multi: { alignItems: 'stretch' },
  prefix: { alignSelf: 'stretch', justifyContent: 'center', paddingHorizontal: space.lg, borderRightWidth: 1, borderRightColor: c.lavender },
  input: { flex: 1, minHeight: 52, paddingHorizontal: space.lg, fontSize: text.lg - 1, color: c.ink },
  inputMulti: { minHeight: 96, paddingTop: space.md, paddingBottom: space.md },
});
