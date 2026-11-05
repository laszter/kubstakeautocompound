import { customType } from "drizzle-orm/pg-core";

/**
 * The single convention for every on-chain amount column: `numeric(78,0)` in Postgres <-> `bigint` in TS.
 * 78 digits covers the full uint256 range (2^256 - 1 has 78 decimal digits). node-postgres returns
 * `numeric` as a string, so the driver value is always a string — never a JS float.
 */
export const wei = customType<{ data: bigint; driverData: string }>({
  dataType: () => "numeric(78,0)",
  toDriver: (v) => v.toString(),
  fromDriver: (v) => BigInt(v),
});
