import { completeCardSetup } from "../../../../../../lib/billing";
import { redirectHome, withRouteErrors } from "../../../../../../lib/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return withRouteErrors(request, async () => {
    const url = new URL(request.url);
    const user = await completeCardSetup({
      sessionId: url.searchParams.get("session_id")
    });

    return redirectHome(request, {
      status: "card_setup_success",
      customerId: url.searchParams.get("customer_id") ?? user.metronomeCustomerId
    });
  });
}
