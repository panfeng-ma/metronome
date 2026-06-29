import { configureAutoRecharge } from "../../../../lib/billing";
import { jsonResponse, readJsonBody, withRouteErrors } from "../../../../lib/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return withRouteErrors(request, async () => {
    const body = await readJsonBody(request);

    await configureAutoRecharge({
      threshold: body.threshold,
      rechargeToAmount: body.minimum_retained_amount ?? body.recharge_to_amount
    });

    return jsonResponse({
      message: "自动充值配置已写入 Metronome Contract。"
    });
  });
}
