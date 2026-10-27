// "No internet" banner without a netinfo package: a NETWORK error from any request turns
// it on, and any successful request turns it off again.
import { errorCode } from './errors';
import { createStore } from './store';

export const offlineStore = createStore(false);

export function reportResult(error: unknown) {
  if (error == null) {
    if (offlineStore.get()) offlineStore.set(false);
    return;
  }
  if (errorCode(error) === 'NETWORK' && !offlineStore.get()) offlineStore.set(true);
}
