// Builds database/schema.sql (the whole current schema in one file) and database/tables.md (every
// table explained) from the migrations, so they are never written by hand and never go stale.
//
//   pnpm db:docs           rewrite both files
//   pnpm db:docs --check   fail if they are out of date (the test suite runs this)
//
// Needs PostgreSQL and pg_dump. Uses a throwaway database on DB_ADMIN_URL (default: local postgres).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { migrate } from './migrate';

const DATABASE_DIR = join(__dirname, '..', '..', '..', 'database');
const SCHEMA_FILE = join(DATABASE_DIR, 'schema.sql');
const TABLES_FILE = join(DATABASE_DIR, 'tables.md');
const ADMIN_URL = process.env.DB_ADMIN_URL || process.env.TEST_ADMIN_DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/postgres';

/** Reading order for tables.md; a table not listed here lands in "Other" so nothing is ever missed. */
const GROUPS: [string, string[]][] = [
  ['Accounts and login', ['users', 'otp_requests', 'sessions', 'device_tokens', 'admin_users']],
  ['Catalogue', ['cities', 'categories']],
  ['Vendors', ['vendors', 'vendor_documents', 'vendor_bank_accounts', 'services', 'packages', 'media', 'availability']],
  ['Events and bookings', ['events', 'bookings', 'reviews', 'shortlists']],
  ['Money', ['payments', 'refunds', 'payouts', 'coupons', 'coupon_redemptions', 'featured_plans', 'featured_purchases']],
  ['Messages, notifications and support', ['conversations', 'messages', 'notifications', 'complaints', 'admin_audit_log', 'system_alerts']],
];

const HEADER = (kind: string) =>
  `-- GENERATED FILE: do not edit. Run \`pnpm --filter @eventseva/backend db:docs\` after adding a migration.\n-- ${kind}\n\n`;

function cleanDump(sql: string): string {
  return sql
    .split('\n')
    // Version banners, session settings and pg_dump's random \restrict keys change between runs.
    .filter((l) => !/^(SET |SELECT pg_catalog\.set_config|-- Dumped (from|by)|\\(un)?restrict )/.test(l))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface Column {
  table_name: string;
  column_name: string;
  type: string;
  not_null: boolean;
  default_value: string | null;
  comment: string | null;
}

async function tablesMarkdown(client: Client): Promise<string> {
  const tables = (
    await client.query<{ name: string; comment: string | null; rows_hint: string }>(
      `SELECT c.relname AS name, obj_description(c.oid, 'pg_class') AS comment
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> 'schema_migrations'`,
    )
  ).rows;
  const columns = (
    await client.query<Column>(
      `SELECT c.relname AS table_name, a.attname AS column_name, format_type(a.atttypid, a.atttypmod) AS type,
              a.attnotnull AS not_null, pg_get_expr(d.adbin, d.adrelid) AS default_value, col_description(c.oid, a.attnum) AS comment
         FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
         LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY c.relname, a.attnum`,
    )
  ).rows;
  const constraints = (
    await client.query<{ table_name: string; type: string; def: string; columns: string[] }>(
      `SELECT c.relname AS table_name, con.contype AS type, pg_get_constraintdef(con.oid) AS def,
              ARRAY(SELECT a.attname::text FROM unnest(con.conkey) k JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k) AS columns
         FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' ORDER BY c.relname, con.contype, pg_get_constraintdef(con.oid)`,
    )
  ).rows;
  const indexes = (
    await client.query<{ table_name: string; def: string }>(
      `SELECT tablename AS table_name, indexdef AS def FROM pg_indexes
        WHERE schemaname = 'public' AND indexname NOT IN (SELECT conname FROM pg_constraint) ORDER BY tablename, indexname`,
    )
  ).rows;
  const enums = (
    await client.query<{ name: string; labels: string[] }>(
      `SELECT t.typname AS name, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS labels
         FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid GROUP BY t.typname ORDER BY t.typname`,
    )
  ).rows;

  const names = new Set(tables.map((t) => t.name));
  const grouped = GROUPS.map(([title, list]) => [title, list.filter((n) => names.has(n))] as [string, string[]]);
  const listed = new Set(grouped.flatMap(([, l]) => l));
  const other = [...names].filter((n) => !listed.has(n)).sort();
  if (other.length) grouped.push(['Other', other]);

  const esc = (s: string) => s.replace(/\|/g, '\\|');
  const out: string[] = [
    '<!-- GENERATED FILE: do not edit. Run `pnpm --filter @eventseva/backend db:docs` after adding a migration. -->',
    '',
    '# EventSeva database tables',
    '',
    `${names.size} tables in PostgreSQL. Money is always in paise (₹1 = 100); \`day\` columns are India dates.`,
    'Table descriptions come from `COMMENT ON TABLE` in the migrations.',
    '',
    '## Contents',
    '',
  ];
  for (const [title, list] of grouped) out.push(`- **${title}:** ${list.map((n) => `[${n}](#${n})`).join(', ')}`);
  out.push('', '## Allowed values (enums)', '');
  for (const e of enums) out.push(`- \`${e.name}\`: ${e.labels.map((l) => `\`${l}\``).join(', ')}`);

  for (const [title, list] of grouped) {
    out.push('', `## ${title}`);
    for (const name of list) {
      const t = tables.find((x) => x.name === name)!;
      const fks = constraints.filter((c) => c.table_name === name && c.type === 'f');
      const fkOf = (col: string) => {
        const fk = fks.find((f) => f.columns.length === 1 && f.columns[0] === col);
        const m = fk && /REFERENCES (\w+)\((\w+)\)/.exec(fk.def);
        return m ? `→ [${m[1]}](#${m[1]}).${m[2]}` : '';
      };
      const pk = constraints.find((c) => c.table_name === name && c.type === 'p')?.columns ?? [];
      out.push('', `### ${name}`, '', t.comment ?? '_No description yet._', '', '| Column | Type | Required | Default | Notes |', '|---|---|---|---|---|');
      for (const c of columns.filter((x) => x.table_name === name)) {
        const notes = [pk.includes(c.column_name) ? 'primary key' : '', fkOf(c.column_name), c.comment ?? ''].filter(Boolean).join('; ');
        out.push(`| \`${c.column_name}\` | ${esc(c.type)} | ${c.not_null ? 'yes' : ''} | ${c.default_value ? `\`${esc(c.default_value)}\`` : ''} | ${esc(notes)} |`);
      }
      const rules = constraints.filter((c) => c.table_name === name && (c.type === 'u' || c.type === 'c' || (c.type === 'f' && c.columns.length > 1)));
      const idx = indexes.filter((i) => i.table_name === name);
      if (rules.length || idx.length) {
        out.push('', '<details><summary>Rules and indexes</summary>', '');
        for (const r of rules) out.push(`- ${r.type === 'u' ? 'Unique' : r.type === 'c' ? 'Check' : 'Foreign key'}: \`${r.def}\``);
        for (const i of idx) out.push(`- Index: \`${i.def.replace(/ ON public\./, ' ON ').replace(/CREATE (UNIQUE )?INDEX \w+ /, 'CREATE $1INDEX ')}\``);
        out.push('', '</details>');
      }
    }
  }
  return out.join('\n') + '\n';
}

export async function buildDocs(): Promise<{ schema: string; tables: string }> {
  const dbName = `eventseva_docs_${process.pid}`;
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  const url = ADMIN_URL.replace(/\/[^/]*$/, `/${dbName}`);
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${dbName}`);
    await migrate(url, () => {});
    const dump = execFileSync('pg_dump', ['--schema-only', '--no-owner', '--no-privileges', '--exclude-table=schema_migrations', url], {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    });
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      return {
        schema: HEADER('The whole EventSeva schema after every migration in database/migrations.') + cleanDump(dump) + '\n',
        tables: await tablesMarkdown(client),
      };
    } finally {
      await client.end();
    }
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  }
}

const read = (f: string) => {
  try {
    return readFileSync(f, 'utf8');
  } catch {
    return '';
  }
};

if (require.main === module) {
  const check = process.argv.includes('--check');
  buildDocs().then(
    ({ schema, tables }) => {
      if (check) {
        const stale = [
          [SCHEMA_FILE, schema],
          [TABLES_FILE, tables],
        ].filter(([f, content]) => read(f) !== content);
        if (stale.length) {
          console.error(`Out of date: ${stale.map(([f]) => f).join(', ')}. Run: pnpm --filter @eventseva/backend db:docs`);
          process.exit(1);
        }
        console.log('database/schema.sql and database/tables.md are up to date');
      } else {
        writeFileSync(SCHEMA_FILE, schema);
        writeFileSync(TABLES_FILE, tables);
        console.log(`wrote ${SCHEMA_FILE} and ${TABLES_FILE}`);
      }
    },
    (err) => {
      console.error(err.message);
      process.exit(1);
    },
  );
}

export { SCHEMA_FILE, TABLES_FILE, read as readIfExists };
