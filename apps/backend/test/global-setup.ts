import { Client } from 'pg';
import { migrate } from '../scripts/migrate';
import { ADMIN_DB_URL, TEST_DB_NAME, TEST_DB_URL } from './env';

/** Fresh database for every test run, built from the same migrations as production. */
export default async function globalSetup() {
  const admin = new Client({ connectionString: ADMIN_DB_URL });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  } finally {
    await admin.end();
  }
  await migrate(TEST_DB_URL, () => {});
}
