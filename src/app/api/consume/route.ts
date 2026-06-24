import { consumeTokens } from "../../../lib/billing";
import { readBody, redirectHome, withRouteErrors } from "../../../lib/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return withRouteErrors(request, async () => {
    const body = await readBody(request);
    await consumeTokens({
      tokens: body.tokens
    });

    return redirectHome(request, {
      status: "consume_success",
      customerId: body.customer_id
    });
  });
}
