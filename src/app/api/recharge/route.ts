import { createRechargeSession } from "../../../lib/billing";
import { readBody, redirectHome, withRouteErrors } from "../../../lib/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return withRouteErrors(request, async () => {
    const body = await readBody(request);
    const session = await createRechargeSession({
      amount: Number(body.amount)
    });

    return redirectHome(request, {
      status: "recharge_pending",
      startedAt: session.startedAt,
      customerId: body.customer_id
    });
  });
}
