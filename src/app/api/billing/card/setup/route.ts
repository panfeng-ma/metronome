import { AppError, createCardSetupSession } from "../../../../../lib/billing";
import { redirectTo, withRouteErrors } from "../../../../../lib/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return withRouteErrors(request, async () => {
    try {
      const session = await createCardSetupSession({
        origin: new URL(request.url).origin
      });

      return redirectTo(request, session.setupUrl);
    } catch (error) {
      if (error instanceof AppError && error.status === 400) {
        if (error.message.includes("Metronome Customer")) {
          return redirectTo(request, "/?status=customer_required");
        }

        return redirectTo(request, "/?status=card_setup_unconfigured");
      }

      throw error;
    }
  });
}
