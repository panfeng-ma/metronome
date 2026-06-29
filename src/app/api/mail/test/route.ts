import { sendTestEmail } from "../../../../lib/billing";
import { jsonResponse, readJsonBody, withRouteErrors } from "../../../../lib/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return withRouteErrors(request, async () => {
    const body = await readJsonBody(request);
    const result = await sendTestEmail({
      to: body.email
    });

    return jsonResponse({
      message: result.dryRun
        ? "测试邮件已进入 dry-run，未完整配置 SMTP_HOST、SMTP_USER 和 SMTP_PASS，邮件内容已打印在服务端日志中。"
        : "测试邮件已发送，请检查目标邮箱。",
      dryRun: result.dryRun
    });
  });
}
