// One-off dev seed for Session 1: a single hand-entered Fitdays body fat reading.
// Usage: npm run seed:dev (reads DATABASE_URL from .env.local)
import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Run via: npm run seed:dev");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

const today = new Date().toISOString().slice(0, 10);

const rows = await sql`
  insert into biometric_readings (source, metric, reading_date, value, unit)
  values ('fitdays', 'body_fat_pct', ${today}, 18.3, '%')
  on conflict (source, metric, reading_date)
  do update set value = excluded.value, unit = excluded.unit, synced_at = now()
  returning id, source, metric, reading_date, value, unit
`;

console.log("Seeded:", rows[0]);
