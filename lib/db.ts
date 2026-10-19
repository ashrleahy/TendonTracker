import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
export const dbEnabled = Boolean(url);
export const sql = url ? neon(url) : null;

let ready: Promise<unknown> | null = null;
export function ensureSchema() {
  if (!sql) return Promise.resolve();
  ready ??= (async () => {
    await sql`CREATE TABLE IF NOT EXISTS tt_entries (
      date date PRIMARY KEY,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE TABLE IF NOT EXISTS tt_settings (
      id int PRIMARY KEY DEFAULT 1,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
  })();
  return ready;
}

/** Optional shared passcode so a public Vercel URL can't read or write your data. */
export function authorised(req: Request): boolean {
  const code = process.env.APP_PASSCODE;
  if (!code) return true;
  return req.headers.get("x-passcode") === code;
}

export const unauthorised = () => Response.json({ error: "passcode" }, { status: 401 });
export const noDb = () => Response.json({ error: "no database" }, { status: 503 });
