import { AppError, deleteBillingCustomer } from "../../../../../lib/billing";
import { readBody, redirectHome, redirectTo, withRouteErrors } from "../../../../../lib/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return withRouteErrors(request, async () => {
    const body = await readBody(request);

    try {
      await deleteBillingCustomer({
        customerId: body.customer_id
      });

      return redirectTo(request, "/?status=customer_deleted");
    } catch (error) {
      if (error instanceof AppError && error.message.includes("METRONOME_BEARER_TOKEN")) {
        return redirectHome(request, {
          status: "customer_delete_unconfigured",
          customerId: body.customer_id
        });
      }

      throw error;
    }
  });
}
