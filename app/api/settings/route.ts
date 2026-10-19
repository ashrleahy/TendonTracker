import { sql, ensureSchema, authorised, unauthorised, noDb } from "@/lib/db";
import { normaliseSettings, type Settings } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!authorised(req)) return unauthorised();
  if (!sql) return noDb();
  await ensureSchema();
  const rows = (await sql`SELECT data FROM tt_settings WHERE id = 1`) as { data: Settings }[];
  return Response.json(normaliseSettings(rows[0]?.data ?? {}));
}

export async function PUT(req: Request) {
  if (!authorised(req)) return unauthorised();
  if (!sql) return noDb();
  await ensureSchema();
  const s = (await req.json()) as Settings;
  await sql`INSERT INTO tt_settings (id, data, updated_at) VALUES (1, ${JSON.stringify(s)}::jsonb, now())
    ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
  return Response.json({ ok: true });
}
