import { execFileSync } from 'node:child_process';
import { buildDocs, readIfExists, SCHEMA_FILE, TABLES_FILE } from '../scripts/db-docs';

const hasPgDump = (() => {
  try {
    execFileSync('pg_dump', ['--version']);
    return true;
  } catch {
    return false;
  }
})();

// database/schema.sql and database/tables.md must match the migrations. If this fails, run
// `pnpm --filter @eventseva/backend db:docs` and commit the result.
(hasPgDump ? describe : describe.skip)('database docs', () => {
  it('schema.sql and tables.md are up to date with the migrations', async () => {
    const { schema, tables } = await buildDocs();
    expect(readIfExists(SCHEMA_FILE)).toBe(schema);
    expect(readIfExists(TABLES_FILE)).toBe(tables);
  }, 60_000);

  it('every table has a description', async () => {
    const { tables } = await buildDocs();
    expect(tables).not.toContain('_No description yet._');
  }, 60_000);
});
