import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getHeartbeat, heartbeatStatus } from "@/lib/worker";

export const dynamic = "force-dynamic";

const noStore = { "cache-control": "no-store" };

/** Public (no auth, excluded from proxy): used by docker healthchecks. Reveals no secrets. */
export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
    const status = heartbeatStatus(await getHeartbeat());
    return NextResponse.json(
      {
        ok: true,
        db: "ok",
        worker: {
          lastTickAt: status.heartbeat?.lastTickAt.toISOString() ?? null,
          ageSec: status.ageSec,
          fresh: status.fresh,
          dryRun: status.dryRun,
        },
      },
      { headers: noStore },
    );
  } catch (err) {
    console.error(`[health] ${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json({ ok: false, db: "error" }, { status: 503, headers: noStore });
  }
}
