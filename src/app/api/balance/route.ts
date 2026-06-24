import { NextResponse } from "next/server";
import { getUserWithMetronomeBalance } from "../../../lib/billing";
import { withRouteErrors } from "../../../lib/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return withRouteErrors(request, async () => NextResponse.json(await getUserWithMetronomeBalance()));
}
