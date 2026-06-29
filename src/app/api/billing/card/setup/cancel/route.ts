import { redirectHomeWithFlash, withRouteErrors } from "../../../../../../lib/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return withRouteErrors(request, async () => {
    return redirectHomeWithFlash(request, {
      message: "已取消绑卡，充值前请先完成银行卡绑定。",
      success: false
    });
  });
}
