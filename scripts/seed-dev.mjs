// One-off dev seed for Session 1: a single hand-entered Fitdays body fat reading.
// Usage: npm run seed:dev (reads DATABASE_URL and PRIMARY_USER_EMAIL from .env.local)
import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Run via: npm run seed:dev");
  process.exit(1);
}
if (!process.env.PRIMARY_USER_EMAIL) {
  console.error("PRIMARY_USER_EMAIL is not set. Run via: npm run seed:dev");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

// Same fail-closed resolution NFR-71 requires of the ingest/Whoop-sync routes:
// never a hardcoded numeric id, and refuse to guess among zero or multiple matches.
const users = await sql`select id from users where email = ${process.env.PRIMARY_USER_EMAIL}`;
if (users.length !== 1) {
  console.error(
    `PRIMARY_USER_EMAIL resolved to ${users.length} users (expected exactly 1) — refusing to seed`,
  );
  process.exit(1);
}
const userId = users[0].id;

const today = new Date().toISOString().slice(0, 10);

const rows = await sql`
  insert into biometric_readings (user_id, source, metric, reading_date, value, unit)
  values (${userId}, 'fitdays', 'body_fat_pct', ${today}, 18.3, '%')
  on conflict (user_id, source, metric, reading_date)
  do update set value = excluded.value, unit = excluded.unit, synced_at = now()
  returning id, source, metric, reading_date, value, unit
`;

console.log("Seeded:", rows[0]);
