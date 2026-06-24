import { NextResponse } from "next/server";
import { AppError } from "./billing";

export type FormBody = Record<string, any>;

export async function withRouteErrors(
  request: Request,
  handler: () => Promise<Response>
): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    return handleRouteError(request, error);
  }
}

export async function readBody(request: Request): Promise<FormBody> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return request.json();
  }

  const formData = await request.formData();
  return Object.fromEntries(formData.entries());
}

export function redirectHome(
  request: Request,
  options: { status?: string; customerId?: any; startedAt?: any }
): Response {
  return redirectTo(request, buildHomeRedirect(options));
}

export function redirectTo(request: Request, location: string): Response {
  return NextResponse.redirect(new URL(location, request.url), { status: 303 });
}

export function buildHomeRedirect({
  status,
  customerId,
  startedAt
}: {
  status?: string;
  customerId?: any;
  startedAt?: any;
}): string {
  const query = new URLSearchParams();
  if (status) {
    query.set("status", status);
  }
  if (customerId) {
    query.set("customer_id", String(customerId));
  }
  if (startedAt) {
    query.set("started_at", String(startedAt));
  }

  const queryString = query.toString();
  return queryString ? `/?${queryString}` : "/";
}

async function handleRouteError(request: Request, error: any): Promise<Response> {
  const normalizedError =
    error instanceof AppError ? error : Object.assign(error, { status: error.status ?? 500 });
  const status = normalizedError.status ?? 500;

  if (status === 409 && normalizedError.message.includes("不足")) {
    return redirectTo(request, "/?status=insufficient_balance");
  }

  if (status === 409 && normalizedError.message.includes("ingest aliases conflict")) {
    return redirectTo(request, "/?status=customer_alias_conflict");
  }

  if (status === 400 && normalizedError.message.includes("Metronome Customer")) {
    return redirectTo(request, "/?status=customer_required");
  }

  if (status === 400 && normalizedError.message.includes("默认付款方式")) {
    return redirectTo(request, "/?status=card_setup_required");
  }

  if (status === 400 && normalizedError.message.includes("METRONOME_RATE_CARD")) {
    return redirectTo(request, "/?status=contract_unconfigured");
  }

  if (status === 502 && normalizedError.message.includes("Metronome usage event failed")) {
    return redirectTo(request, "/?status=consume_failed");
  }

  if (status >= 500) {
    console.error(normalizedError);
  }

  return new Response(normalizedError.message || "Server error", { status });
}
