import { deleteBillingCustomer } from "../../../../../lib/billing";
import { jsonResponse, readJsonBody, withRouteErrors } from "../../../../../lib/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return withRouteErrors(request, async () => {
    const body = await readJsonBody(request);

    await deleteBillingCustomer({
      customerId: body.customer_id
    });

    return jsonResponse({
      message: "当前 Metronome Customer 已归档，本地状态已重置。"
    });
  });
}
