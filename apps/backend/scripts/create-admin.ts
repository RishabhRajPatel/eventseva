// Creates an admin login for the admin panel and prints the 2FA secret to add to an
// authenticator app, plus 8 one-time recovery codes. The secret is stored encrypted. Usage: pnpm create-admin <email> <role>   (password is read from ADMIN_PASSWORD)
import { Client } from 'pg';
import { ADMIN_ROLES, AdminRole } from '../src/admin/admin-auth';
import { hashPassword } from '../src/admin/password';
import { newTotpSecret, otpauthUrl } from '../src/admin/totp';
import { newRecoveryCodes, sealSecret } from '../src/admin/admin-2fa';
import { dataKeyFrom } from '../src/config';

async function main() {
  const [email, role] = process.argv.slice(2);
  const password = process.env.ADMIN_PASSWORD;
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  if (!email || !ADMIN_ROLES.includes(role as AdminRole)) throw new Error(`usage: create-admin <email> <${ADMIN_ROLES.join('|')}>`);
  if (!password || password.length < 12) throw new Error('set ADMIN_PASSWORD (at least 12 characters)');

  const secret = newTotpSecret();
  // Must be the same BANK_DETAILS_KEY as the API server, or the 2FA secret cannot be read there.
  const key = dataKeyFrom(process.env);
  const recovery = newRecoveryCodes(key);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      'INSERT INTO admin_users (email, password_hash, totp_secret, role, recovery_codes) VALUES ($1, $2, $3, $4, $5)',
      [email.trim().toLowerCase(), await hashPassword(password), sealSecret(secret, key), role, recovery.hashes],
    );
  } finally {
    await client.end();
  }
  console.log(`Admin ${email} (${role}) created.`);
  console.log(`Add this to Google Authenticator / Authy:\n  secret: ${secret}\n  ${otpauthUrl(secret, email)}`);
  console.log('\nRecovery codes (each works once, if the phone is lost). Save them somewhere safe NOW; they are not shown again:');
  for (const code of recovery.codes) console.log(`  ${code}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
