import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm, LoginShell } from './LoginForm';

export const metadata: Metadata = { title: 'Log in' };

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginShell />}>
      <LoginForm />
    </Suspense>
  );
}
