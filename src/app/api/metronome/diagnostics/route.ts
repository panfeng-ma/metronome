import { NextResponse } from "next/server";
import { getMetronomeBillingDiagnostics } from "../../../../lib/billing";
import { withRouteErrors } from "../../../../lib/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return withRouteErrors(request, async () => {
    const url = new URL(request.url);
    return NextResponse.json(
      await getMetronomeBillingDiagnostics(url.searchParams.get("user_id") ?? "demo")
    );
  });
}
