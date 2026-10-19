import { sql, ensureSchema, authorised, unauthorised, noDb } from "@/lib/db";
import type { Entry } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!authorised(req)) return unauthorised();
  if (!sql) return noDb();
  await ensureSchema();
  const rows = (await sql`SELECT data FROM tt_entries ORDER BY date`) as { data: Entry }[];
  return Response.json(rows.map((r) => r.data));
}

export async function PUT(req: Request) {
  if (!authorised(req)) return unauthorised();
  if (!sql) return noDb();
  await ensureSchema();
  const body = (await req.json()) as Entry | Entry[];
  const list = Array.isArray(body) ? body : [body];
  for (const e of list) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) return Response.json({ error: "bad date" }, { status: 400 });
    await sql`INSERT INTO tt_entries (date, data, updated_at) VALUES (${e.date}, ${JSON.stringify(e)}::jsonb, now())
      ON CONFLICT (date) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
  }
  return Response.json({ ok: true, saved: list.length });
}

export async function DELETE(req: Request) {
  if (!authorised(req)) return unauthorised();
  if (!sql) return noDb();
  const date = new URL(req.url).searchParams.get("date");
  if (!date) return Response.json({ error: "date required" }, { status: 400 });
  await ensureSchema();
  await sql`DELETE FROM tt_entries WHERE date = ${date}`;
  return Response.json({ ok: true });
}
