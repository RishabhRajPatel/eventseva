This is the EventSeva API: NestJS 11 over PostgreSQL 16, **plain SQL only** — no ORM, no query builder.
All business rules live here; the apps and the admin panel are thin clients over these routes.

## Commands

```bash
pnpm lint          # tsc --noEmit — run before calling anything done
pnpm test          # jest --runInBand; needs PostgreSQL and creates the eventseva_test database
pnpm build         # tsc -> dist/
pnpm migrate       # applies database/migrations
pnpm db:docs       # regenerates database/tables.md from the live schema
```

After any migration, run `pnpm db:docs` and commit `database/tables.md` with it —
`test/db-docs.spec.ts` runs `db:docs --check` and fails when the two drift apart.

**Nothing loads `.env`.** The server reads `process.env` directly, because Docker supplies it via
`env_file` (see `docker-compose.yml`). Running anything by hand needs the environment sourced first:

```bash
set -a && . ./.env && set +a && node dist/main.js    # same for migrate and create-admin
```

`pnpm test` does not need this: `test/env.ts` sets its own variables. `TEST_ADMIN_DATABASE_URL` must
point at a superuser that can `CREATE DATABASE`.

## SQL

- **Values always go through `$1`, `$2`.** Never join user input into SQL. Interpolation (`${…}`) is
  allowed only for module constants, column lists and literal ternaries — never for anything that
  reaches the process from a request.
- **Qualify `ORDER BY` with the table name.** A bare `ORDER BY id` binds to an *output column* of
  that name before the table column. Selecting `id::text` or `id::int` therefore makes the sort key
  an expression: the index can no longer satisfy the order, so the query reads and sorts every
  matching row. This was real, in three places — the chat page alone went from 15.7 ms (reading all
  20 000 messages of a conversation) to 0.087 ms once fixed.
- **Do not cast bigint ids.** `messages`, `notifications`, `admin_audit_log` and `system_alerts` have
  `bigint` ids. `id::int` fails with "integer out of range" past 2 147 483 647. `db.service.ts`
  registers an `INT8` parser so bigint arrives as a JS number (exact to 2^53) and the apps keep the
  `id: number` they expect. Aggregates (`sum`, `count`) stay explicitly cast — `COALESCE(sum(x), 0)::int`.
- `LIKE`/`ILIKE` on user text must escape wildcards: `value.replace(/[%_\\]/g, '\\$&')`.
- Dates: Postgres `date` stays a `'YYYY-MM-DD'` string (see the `DATE` parser). An event day must
  never shift with a time zone. India time is `AT TIME ZONE 'Asia/Kolkata'`.

## Transactions and races

- `db.tx(fn)` wraps `BEGIN`/`COMMIT` and records the actor for `booking_state_history`. Pass the
  `client` down — every helper (`notify`, `postBookingEvent`, `releaseAll`, …) takes a `Queryable`.
- **A claim and its side effects share one transaction.** Flipping a row's status in one statement
  and sending its notifications afterwards is a bug: a crash in between leaves the row claimed with
  its work undone, and nothing retries it because the claim no longer matches. `BookingsService.drain()`
  is the pattern — claim a bounded batch, do its side effects, commit, repeat.
- Serialise with the narrowest lock that works, in this order of preference:
  `FOR UPDATE` on the row that owns the decision (a vendor row serialises its bookings) →
  `pg_advisory_xact_lock(hashtext(key))` for capacity pools and per-phone OTP →
  `FOR UPDATE SKIP LOCKED` for queues several servers drain at once.
- Money writes are idempotent by constraint, not by checking first: `ON CONFLICT (booking_id) DO NOTHING`.
- Take locks in a consistent order — booking row first, then conversation/capacity — or two paths
  will deadlock.

## Background jobs

Four services run on timers (`BookingsService.sweep`, `PaymentEventsService.reconcile`,
`RefundsService.flush`, `PushService.dispatchPending`). Every one of them must:

1. keep the in-flight promise in `this.running` and **return early if it is set**, so a run that
   outlasts its interval never has a second stacked behind it;
2. `await this.running` in `onModuleDestroy`, so a deploy never cuts a run in half;
3. claim work with `FOR UPDATE SKIP LOCKED` (or an atomic `UPDATE … RETURNING`), because several API
   servers run the same timers.

## Money

Paise are integers everywhere. Percentages go through `Math.round((amount * percent) / 100)`; a split
must not lose a paisa (`Math.floor(t/2)` and `t - Math.floor(t/2)`). Only CSV exports divide by 100.0,
for spreadsheets.

## Errors

Throw `AppError(code, message, status, details?)`. The code is the stable contract the apps switch on;
the message is shown to the user. `ErrorFilter` renders every error as
`{ "error": { "code", "message", ...details } }` and keeps stack traces in the log.

## Tests

`test/*.spec.ts` are end-to-end over a real database and a real HTTP server — prefer them to unit tests.
A test for a bug must fail against the unfixed code; check that before trusting it. Tests share one
database, so anything a test changes outside the tables `t.reset()` truncates (sequences, triggers,
functions) has to be restored in a `finally`.
