import { createRechargeSession } from "../../../lib/billing";
import { jsonResponse, readJsonBody, withRouteErrors } from "../../../lib/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return withRouteErrors(request, async () => {
    const body = await readJsonBody(request);
    const session = await createRechargeSession({
      amount: Number(body.amount)
    });

    return jsonResponse({
      message:
        "已发起充值，Metronome 正在通过 Stripe 自动扣款，余额会在 Webhook 同步后更新。",
      startedAt: session.startedAt,
      customerId: body.customer_id
    });
  });
}
