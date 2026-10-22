// Creates an admin login for the admin panel and prints the 2FA secret to add to an
// authenticator app. Usage: pnpm create-admin <email> <role>   (password is read from ADMIN_PASSWORD)
import { Client } from 'pg';
import { ADMIN_ROLES, AdminRole } from '../src/admin/admin-auth';
import { hashPassword } from '../src/admin/password';
import { newTotpSecret, otpauthUrl } from '../src/admin/totp';

async function main() {
  const [email, role] = process.argv.slice(2);
  const password = process.env.ADMIN_PASSWORD;
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  if (!email || !ADMIN_ROLES.includes(role as AdminRole)) throw new Error(`usage: create-admin <email> <${ADMIN_ROLES.join('|')}>`);
  if (!password || password.length < 12) throw new Error('set ADMIN_PASSWORD (at least 12 characters)');

  const secret = newTotpSecret();
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      'INSERT INTO admin_users (email, password_hash, totp_secret, role) VALUES ($1, $2, $3, $4)',
      [email.trim().toLowerCase(), await hashPassword(password), secret, role],
    );
  } finally {
    await client.end();
  }
  console.log(`Admin ${email} (${role}) created.`);
  console.log(`Add this to Google Authenticator / Authy:\n  secret: ${secret}\n  ${otpauthUrl(secret, email)}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
