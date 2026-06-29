import { NextResponse } from "next/server";
import { applyMetronomeWebhook } from "../../../../lib/billing";
import { readJsonBody, withRouteErrors } from "../../../../lib/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return withRouteErrors(request, async () => {
    const body = await readJsonBody(request);
    console.log("metronome webhook received", body);
    const result = await applyMetronomeWebhook(body);
    return NextResponse.json({ ok: true, ...result });
  });
}
