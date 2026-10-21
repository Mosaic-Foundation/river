// Circles (spec F8): create, rename, recolor and delete a member's circles, and add or remove
// spaces. A space can be in several circles. Runs inside forAccount(): row-level security limits
// every statement to the member's own circles and their members (check 27).
//
// The one circle with role = civic (seeded as "Civic") keeps its role when renamed and can't be
// deleted: Civic mode reads it (spec F9), and there is no screen to give the role to another
// circle (DECISIONS.md "The civic-role circle stays").
import type { Db } from "../../db/context.js";
import { FollowingError, followsSpace, type CircleView } from "./service.js";

export const MAX_CIRCLES = 50;
export const MAX_NAME = 60;
const COLOR = /^#[0-9a-f]{6}$/i;

export function parseCircleName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (!name) throw new FollowingError(400, "bad_name", "Give the circle a name.");
  if (name.length > MAX_NAME) throw new FollowingError(400, "bad_name", `Keep the name under ${MAX_NAME} characters.`);
  return name;
}

export function parseCircleColor(raw: unknown): string {
  if (typeof raw !== "string" || !COLOR.test(raw)) {
    throw new FollowingError(400, "bad_color", "Pick a color like #2F6FA8.");
  }
  return raw.toUpperCase();
}

async function nameTaken(db: Db, name: string, except?: string): Promise<boolean> {
  const { rows } = await db.query(
    "SELECT 1 FROM river.circles WHERE lower(name) = lower($1) AND ($2::uuid IS NULL OR id <> $2::uuid) LIMIT 1",
    [name, except ?? null],
  );
  return rows.length > 0;
}

function view(row: { id: string; name: string; color: string | null; role: "civic" | null }, spaceIds: string[] = []): CircleView {
  return { id: row.id, name: row.name, color: row.color, role: row.role, spaceIds };
}

export async function createCircle(db: Db, input: { name: unknown; color: unknown }): Promise<CircleView> {
  const name = parseCircleName(input.name);
  const color = parseCircleColor(input.color);
  const { rows: count } = await db.query<{ n: number; next: number }>(
    "SELECT count(*)::int AS n, coalesce(max(sort) + 1, 0)::int AS next FROM river.circles",
  );
  if ((count[0]?.n ?? 0) >= MAX_CIRCLES) {
    throw new FollowingError(409, "too_many_circles", `You can have up to ${MAX_CIRCLES} circles.`);
  }
  if (await nameTaken(db, name)) throw new FollowingError(409, "name_taken", "You already have a circle with that name.");
  const { rows } = await db.query<{ id: string; name: string; color: string | null; role: "civic" | null }>(
    "INSERT INTO river.circles (name, color, sort) VALUES ($1, $2, $3) RETURNING id, name, color, role",
    [name, color, count[0]?.next ?? 0],
  );
  return view(rows[0]!);
}

/** Renames and/or recolors a circle. The civic circle keeps role = civic (the column isn't touched). */
export async function updateCircle(db: Db, id: string, input: { name?: unknown; color?: unknown }): Promise<CircleView> {
  const name = input.name === undefined ? null : parseCircleName(input.name);
  const color = input.color === undefined ? null : parseCircleColor(input.color);
  if (name === null && color === null) throw new FollowingError(400, "nothing_to_change", "Send a name or a color.");
  if (name !== null && (await nameTaken(db, name, id))) {
    throw new FollowingError(409, "name_taken", "You already have a circle with that name.");
  }
  const { rows } = await db.query<{ id: string; name: string; color: string | null; role: "civic" | null }>(
    `UPDATE river.circles SET name = coalesce($2, name), color = coalesce($3, color)
      WHERE id = $1 RETURNING id, name, color, role`,
    [id, name, color],
  );
  if (!rows[0]) throw new FollowingError(404, "unknown_circle", "That circle isn't one of yours.");
  const { rows: members } = await db.query<{ space_id: string }>(
    "SELECT space_id FROM river.circle_members WHERE circle_id = $1",
    [id],
  );
  return view(rows[0], members.map((m) => m.space_id));
}

export async function deleteCircle(db: Db, id: string): Promise<void> {
  const { rows } = await db.query<{ role: string | null }>("SELECT role FROM river.circles WHERE id = $1", [id]);
  if (!rows[0]) throw new FollowingError(404, "unknown_circle", "That circle isn't one of yours.");
  if (rows[0].role === "civic") {
    throw new FollowingError(409, "civic_circle", "The Civic circle can't be deleted. You can rename it.");
  }
  // circle_members rows go with it (ON DELETE CASCADE).
  await db.query("DELETE FROM river.circles WHERE id = $1", [id]);
}

/** Puts a followed space in a circle (idempotent). */
export async function addCircleMember(db: Db, circleId: string, spaceId: string): Promise<void> {
  const { rows } = await db.query("SELECT 1 FROM river.circles WHERE id = $1", [circleId]);
  if (rows.length === 0) throw new FollowingError(404, "unknown_circle", "That circle isn't one of yours.");
  if (!(await followsSpace(db, spaceId))) {
    throw new FollowingError(400, "not_followed", "Follow that space before adding it to a circle.");
  }
  await db.query(
    "INSERT INTO river.circle_members (circle_id, space_id) VALUES ($1, $2) ON CONFLICT (circle_id, space_id) DO NOTHING",
    [circleId, spaceId],
  );
}

export async function removeCircleMember(db: Db, circleId: string, spaceId: string): Promise<void> {
  const { rows } = await db.query("SELECT 1 FROM river.circles WHERE id = $1", [circleId]);
  if (rows.length === 0) throw new FollowingError(404, "unknown_circle", "That circle isn't one of yours.");
  await db.query("DELETE FROM river.circle_members WHERE circle_id = $1 AND space_id = $2", [circleId, spaceId]);
}
