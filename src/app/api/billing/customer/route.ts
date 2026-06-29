import { createBillingCustomer, createCardSetupSession } from "../../../../lib/billing";
import { jsonResponse, withRouteErrors } from "../../../../lib/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return withRouteErrors(request, async () => {
    const result = await createBillingCustomer();
    const session = await createCardSetupSession({
      origin: new URL(request.url).origin
    });

    return jsonResponse({
      redirectUrl: session.setupUrl,
      customerId: result.user.metronomeCustomerId
    });
  });
}
