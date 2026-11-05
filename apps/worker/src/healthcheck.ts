import pg from "pg";

// Container healthcheck: exit 0 when worker_heartbeat.last_tick_at is fresher than 3 × TICK_INTERVAL_SEC
// (age computed with the database clock), exit 1 otherwise (or on any error / after 10s).

async function main(): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("healthcheck: DATABASE_URL is required");
    return 1;
  }
  const interval = Number(process.env.TICK_INTERVAL_SEC);
  const tickSec = Number.isFinite(interval) && interval > 0 ? interval : 30;
  const maxAgeSec = 3 * tickSec;

  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
  client.on("error", () => {});
  try {
    await client.connect();
    const res = await client.query<{ age: string | null }>(
      "SELECT EXTRACT(EPOCH FROM (now() - last_tick_at))::text AS age FROM worker_heartbeat WHERE id = 1",
    );
    const age = res.rows[0]?.age == null ? null : Number(res.rows[0].age);
    const fresh = age !== null && Number.isFinite(age) && age < maxAgeSec;
    console.log(JSON.stringify({ ok: fresh, ageSec: age === null ? null : Math.round(age), maxAgeSec }));
    return fresh ? 0 : 1;
  } catch (err) {
    console.error(`healthcheck: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  } finally {
    await client.end().catch(() => {});
  }
}

setTimeout(() => process.exit(1), 10_000).unref();
main().then(
  (code) => process.exit(code),
  () => process.exit(1),
);
