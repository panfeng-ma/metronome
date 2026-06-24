import { AppError, configureAutoRecharge } from "../../../../lib/billing";
import { readBody, redirectHome, redirectTo, withRouteErrors } from "../../../../lib/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return withRouteErrors(request, async () => {
    const body = await readBody(request);

    try {
      await configureAutoRecharge({
        threshold: body.threshold,
        rechargeToAmount: body.minimum_retained_amount ?? body.recharge_to_amount
      });

      return redirectHome(request, {
        status: "auto_recharge_configured",
        customerId: body.customer_id
      });
    } catch (error) {
      if (error instanceof AppError && error.status === 400) {
        if (error.message.includes("Customer")) {
          return redirectTo(request, "/?status=customer_required");
        }

        if (error.message.includes("默认付款方式")) {
          return redirectHome(request, {
            status: "card_setup_required",
            customerId: body.customer_id
          });
        }

        if (
          error.message.includes("recharge_to_amount must be at least") ||
          error.message.includes("最低保留额度至少") ||
          error.message.includes("最低保留额度至少比触发阈值高")
        ) {
          return redirectHome(request, {
            status: "auto_recharge_amount_too_low",
            customerId: body.customer_id
          });
        }

        if (error.message.includes("最低保留额度必须大于触发阈值")) {
          return redirectHome(request, {
            status: "auto_recharge_invalid_range",
            customerId: body.customer_id
          });
        }

        if (error.message.includes("METRONOME_COMMIT_PRODUCT_ID")) {
          return redirectHome(request, {
            status: "auto_recharge_product_unconfigured",
            customerId: body.customer_id
          });
        }

        if (error.message.includes("billing configuration")) {
          return redirectHome(request, {
            status: "auto_recharge_billing_provider_invalid",
            customerId: body.customer_id
          });
        }

        return redirectHome(request, {
          status: "auto_recharge_unconfigured",
          customerId: body.customer_id
        });
      }

      throw error;
    }
  });
}
