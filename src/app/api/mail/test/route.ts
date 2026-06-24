import { AppError, sendTestEmail } from "../../../../lib/billing";
import { readBody, redirectHome, withRouteErrors } from "../../../../lib/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return withRouteErrors(request, async () => {
    const body = await readBody(request);

    try {
      const result = await sendTestEmail({
        to: body.email
      });

      return redirectHome(request, {
        status: result.dryRun ? "test_email_dry_run" : "test_email_sent",
        customerId: body.customer_id
      });
    } catch (error) {
      if (error instanceof AppError && error.status === 400) {
        return redirectHome(request, {
          status: "test_email_invalid",
          customerId: body.customer_id
        });
      }

      console.error(error);
      return redirectHome(request, {
        status: "test_email_failed",
        customerId: body.customer_id
      });
    }
  });
}
