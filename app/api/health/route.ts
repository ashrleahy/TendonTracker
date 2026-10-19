import { dbEnabled, authorised } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return Response.json({
    db: dbEnabled,
    passcodeRequired: Boolean(process.env.APP_PASSCODE),
    authorised: authorised(req),
  });
}
