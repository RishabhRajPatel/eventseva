import { redirect } from 'next/navigation';

// The panel guard sends logged-out admins on to /login.
export default function Home() {
  redirect('/dashboard');
}
