import { Redirect } from 'expo-router';
import { View } from 'react-native';
import { useSession } from '../lib/session';
import { useVendor } from '../lib/queries';
import { routeFor } from '../lib/routing';
import { ErrorState, Loading } from '../components/States';
import { c } from '../lib/theme';

/** Entry point: sends the vendor to login, name, onboarding, the review screen or the tabs. */
export default function Gate() {
  const { me } = useSession();
  if (!me) return <Redirect href="/login" />;
  if (!me.name?.trim()) return <Redirect href="/name" />;
  return <VendorGate name={me.name} />;
}

function VendorGate({ name }: { name: string }) {
  const vendor = useVendor();
  if (vendor.data !== undefined) return <Redirect href={routeFor({ name, vendorStatus: vendor.data?.status ?? null })} />;
  return <View style={{ flex: 1, backgroundColor: c.cream }}>{vendor.isError ? <ErrorState error={vendor.error} onRetry={() => void vendor.refetch()} /> : <Loading />}</View>;
}
