import { consumeTokens } from "../../../lib/billing";
import { jsonResponse, readJsonBody, withRouteErrors } from "../../../lib/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return withRouteErrors(request, async () => {
    const body = await readJsonBody(request);
    await consumeTokens({
      tokens: body.tokens
    });

    return jsonResponse({
      message: "Token usage 已上报，余额以 Metronome 计算结果为准。"
    });
  });
}
