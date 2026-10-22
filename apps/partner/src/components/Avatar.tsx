import { View } from 'react-native';
import { c } from '../lib/theme';
import { Txt } from './Txt';

export function Avatar({ name, size = 44, bg = c.lilac }: { name: string; size?: number; bg?: string }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Txt variant="bold" size={size > 48 ? 'xl' : 'md'} color={c.indigo}>
        {(name.trim()[0] ?? '?').toUpperCase()}
      </Txt>
    </View>
  );
}
