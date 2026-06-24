import { AppError, createBillingCustomer, createCardSetupSession } from "../../../../lib/billing";
import { redirectHome, redirectTo, withRouteErrors } from "../../../../lib/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return withRouteErrors(request, async () => {
    let customerId;

    try {
      const result = await createBillingCustomer();
      customerId = result.user.metronomeCustomerId;
      const session = await createCardSetupSession({
        origin: new URL(request.url).origin
      });

      return redirectTo(request, session.setupUrl);
    } catch (error) {
      if (error instanceof AppError && error.message.includes("METRONOME_BEARER_TOKEN")) {
        return redirectTo(request, "/?status=customer_unconfigured");
      }

      if (error instanceof AppError && error.status === 400) {
        if (error.message.includes("METRONOME_RATE_CARD")) {
          return redirectTo(request, "/?status=contract_unconfigured");
        }

        if (error.message.includes("STRIPE_SECRET_KEY")) {
          return redirectHome(request, {
            status: "card_setup_unconfigured",
            customerId
          });
        }

        if (error.message.includes("Metronome Customer")) {
          return redirectTo(request, "/?status=customer_required");
        }
      }

      throw error;
    }
  });
}
