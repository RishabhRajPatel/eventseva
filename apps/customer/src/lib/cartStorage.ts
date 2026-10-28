// The cart file in the app's private documents folder (not synced, removed with the app).
import { File, Paths } from 'expo-file-system';
import type { CartStorage } from './cart';

export function fileCartStorage(): CartStorage {
  const file = new File(Paths.document, 'cart.json');
  return {
    load: () => (file.exists ? file.textSync() : null),
    save: (json) => file.writeSync(json),
  };
}
