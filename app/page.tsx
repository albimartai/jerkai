import { getSql } from "@/lib/db";

// Always query at request time — this page must reflect the live database,
// never a build-time snapshot.
export const dynamic = "force-dynamic";

type BodyFatReading = {
  value: string;
  unit: string | null;
  reading_date: string;
};

export default async function Home() {
  const sql = getSql();
  const rows = (await sql`
    select value, unit, to_char(reading_date, 'YYYY-MM-DD') as reading_date
    from biometric_readings
    where source = 'fitdays' and metric = 'body_fat_pct'
    order by reading_date desc
    limit 1
  `) as BodyFatReading[];

  const reading = rows[0];

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 font-sans">
      <h1 className="text-lg text-zinc-500">Body fat</h1>
      {reading ? (
        <>
          <p className="text-5xl font-semibold tracking-tight">
            Today: {Number(reading.value)}
            {reading.unit ?? ""}
          </p>
          <p className="text-sm text-zinc-500">
            Measured {reading.reading_date} · Fitdays
          </p>
        </>
      ) : (
        <p className="text-2xl text-zinc-500">No readings yet.</p>
      )}
    </main>
  );
}
