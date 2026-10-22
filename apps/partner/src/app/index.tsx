import { rupees } from '@eventseva/app-shared';
import { Text, View } from 'react-native';

export default function Home() {
  return (
    <View>
      <Text>{rupees(150000)}</Text>
    </View>
  );
}
