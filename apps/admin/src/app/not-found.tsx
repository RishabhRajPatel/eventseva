import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="state" style={{ margin: '4rem auto', maxWidth: '28rem' }}>
      <h1>Page not found</h1>
      <p className="muted">This page does not exist in the admin panel.</p>
      <Link className="btn btn-primary" href="/dashboard">
        Go to dashboard
      </Link>
    </main>
  );
}
