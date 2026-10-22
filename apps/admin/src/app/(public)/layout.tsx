import type { Metadata } from 'next';
import styles from './public.module.css';

// Public pages linked from the Play Store listings. No login, and search engines may index them.
export const metadata: Metadata = { robots: { index: true, follow: true } };


export default function PublicLayout({ children }: LayoutProps<'/'>) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.brand}>EventSeva</span>
      </header>
      <main className={styles.article}>{children}</main>
    </div>
  );
}
