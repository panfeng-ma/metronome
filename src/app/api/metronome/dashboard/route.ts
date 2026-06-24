import { NextResponse } from "next/server";
import { getEmbeddableDashboardUrl } from "../../../../lib/billing";
import { withRouteErrors } from "../../../../lib/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return withRouteErrors(request, async () => {
    const url = new URL(request.url);
    const dashboard = url.searchParams.get("dashboard") ?? "commits_and_credits";
    const customerId = url.searchParams.get("customer_id") ?? undefined;

    return NextResponse.json(
      await getEmbeddableDashboardUrl({
        customerId,
        dashboard,
      }),
    );
  });
}
