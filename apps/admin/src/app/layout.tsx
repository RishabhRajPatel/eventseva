import type { Metadata } from 'next';
import { Lato, Playfair_Display } from 'next/font/google';
import './globals.css';

const lato = Lato({ variable: '--font-body', subsets: ['latin'], weight: ['400', '700'] });
const playfair = Playfair_Display({ variable: '--font-display', subsets: ['latin'], weight: ['600', '700'] });

export const metadata: Metadata = {
  title: { default: 'EventSeva Admin', template: '%s · EventSeva Admin' },
  description: 'EventSeva team panel: vendors, photos, bookings, payouts, complaints and users.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${lato.variable} ${playfair.variable}`}>
      <body>{children}</body>
    </html>
  );
}
