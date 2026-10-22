// Minimal migration runner. Files use dbmate's format (`-- migrate:up` / `-- migrate:down`)
// and the same `schema_migrations` table, so dbmate can take over later without changes.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

// Migrations live in the top-level database/ folder, next to the generated schema and table docs.
const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'database', 'migrations');

export function upSection(sql: string): string {
  const start = sql.indexOf('-- migrate:up');
  const end = sql.indexOf('-- migrate:down');
  if (start === -1) throw new Error('missing "-- migrate:up"');
  return sql.slice(start + '-- migrate:up'.length, end === -1 ? undefined : end);
}

export async function migrate(databaseUrl: string, log: (msg: string) => void = console.log): Promise<string[]> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version varchar(128) PRIMARY KEY)');
    const done = new Set((await client.query('SELECT version FROM schema_migrations')).rows.map((r) => r.version));
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      const version = file.split('_')[0];
      if (done.has(version)) continue;
      await client.query('BEGIN');
      try {
        await client.query(upSection(readFileSync(join(MIGRATIONS_DIR, file), 'utf8')));
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${file} failed: ${(err as Error).message}`);
      }
      applied.push(file);
      log(`applied ${file}`);
    }
  } finally {
    await client.end();
  }
  return applied;
}

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  migrate(url).then(
    (files) => console.log(files.length ? `done (${files.length} applied)` : 'nothing to apply'),
    (err) => {
      console.error(err.message);
      process.exit(1);
    },
  );
}
