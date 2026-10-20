// Every table in the river schema and whose rows it holds (spec 3.1). The migrations' row-level
// security policies follow the same kinds; tests/api/db/catalog.test.ts fails when a table in the
// database is missing here or here and not there.
//
//   config    written by migrations only; river_app reads every row
//   instance  rows of one instance; insert stamps instance_id
//   account   rows of one member of one instance; insert stamps instance_id and account_id
//   shared    public source data every account reads; nothing to stamp
export const RIVER_TABLES = {
  instances: "config",
  accounts: "instance",
  spaces: "shared",
  streams: "shared",
  items: "shared",
  follows: "account",
  circles: "account",
  circle_members: "instance",
  read_state: "account",
  preferences: "account",
} as const;

export type RiverTable = keyof typeof RIVER_TABLES;
export type TableKind = (typeof RIVER_TABLES)[RiverTable];

export function isRiverTable(name: string): name is RiverTable {
  return Object.hasOwn(RIVER_TABLES, name);
}
