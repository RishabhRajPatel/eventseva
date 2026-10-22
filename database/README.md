# EventSeva database

PostgreSQL 16. Everything about the database lives in this folder.

| File | What it is | Edit it? |
|---|---|---|
| [`tables.md`](tables.md) | **Every table explained**: what it is for, columns, types, links to other tables, rules | No, generated |
| [`schema.sql`](schema.sql) | **The whole schema in one file**: every table, type, index and rule as it is today | No, generated |
| [`migrations/`](migrations) | The history of changes, applied in order. **The source of truth.** | Yes, add new files only |

**In short (Hindi):** tables ki poori jaankari `tables.md` me hai, aur poora schema ek hi file `schema.sql` me.
Ye dono script se bante hain. Database me badlav hamesha `migrations/` me nayi file jodkar hota hai, purani file
kabhi nahi badalti.

## Making a change

1. Add a new file in `migrations/`, named with the date and a short name, e.g. `20261101000001_vendor_gst.sql`:

   ```sql
   -- migrate:up
   ALTER TABLE vendors ADD COLUMN gst_number text;
   COMMENT ON COLUMN vendors.gst_number IS 'GSTIN, shown on invoices';

   -- migrate:down
   ALTER TABLE vendors DROP COLUMN gst_number;
   ```

   Never edit a migration that has already run on a server; add a new one instead. Give every new table a
   `COMMENT ON TABLE`, because that text becomes its description in `tables.md`.

2. Apply it to your database: `pnpm --filter @eventseva/backend migrate`.
3. Regenerate the docs: `pnpm --filter @eventseva/backend db:docs`. This rewrites `schema.sql` and `tables.md`.
4. Commit the migration together with the two regenerated files.

The backend tests fail if `schema.sql` or `tables.md` are out of date, so a forgotten step 3 is caught.

## Rules used everywhere

- **Money:** whole **paise** (`int`, ₹1 = 100), never decimals.
- **Dates:** `day` / `event_date` are plain India dates (`date`); everything else is `timestamptz`.
- **Keys:** ids are UUIDs (`gen_random_uuid()`), except small lookup tables (cities, categories, plans,
  coupons), which use serial numbers.
- **Deleting:** almost nothing is deleted. Rows are hidden (`is_active`), soft-deleted (`deleted_at`) or
  closed with a status, because bookings and payments must stay on record.
- **Secrets:** only hashes (OTP codes, refresh tokens, admin passwords) or encrypted values (bank account
  numbers) are stored.

## Tools

The migration runner (`apps/backend/scripts/migrate.ts`) uses dbmate's file format and its
`schema_migrations` table, so [dbmate](https://github.com/amacneil/dbmate) can be used instead at any time.
To browse the data, any PostgreSQL tool works (psql, DBeaver, pgAdmin, TablePlus); the table comments show
up there too.
