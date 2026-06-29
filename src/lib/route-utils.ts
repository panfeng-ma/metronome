import { NextResponse } from "next/server";
import { AppError } from "./billing";

export type JsonBody = Record<string, unknown>;

export async function withRouteErrors(
  request: Request,
  handler: () => Promise<Response>
): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function readJsonBody(request: Request): Promise<JsonBody> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return request.json();
  }

  const formData = await request.formData();
  return Object.fromEntries(formData.entries());
}

export function jsonResponse(data: unknown, status = 200): Response {
  return NextResponse.json(data, { status });
}

export function jsonError(message: string, status: number): Response {
  return jsonResponse({ error: message }, status);
}

export function redirectTo(request: Request, location: string): Response {
  return NextResponse.redirect(new URL(location, request.url), { status: 303 });
}

export function redirectHomeWithFlash(
  request: Request,
  flash: { message: string; success?: boolean }
): Response {
  const response = NextResponse.redirect(new URL("/", request.url), { status: 303 });
  response.cookies.set("flash", JSON.stringify(flash), {
    maxAge: 60,
    path: "/",
    sameSite: "lax"
  });
  return response;
}

function handleRouteError(error: unknown): Response {
  const normalizedError =
    error instanceof AppError
      ? error
      : error instanceof Error
        ? Object.assign(error, { status: (error as { status?: number }).status ?? 500 })
        : new AppError("Server error", 500);
  const status = normalizedError.status ?? 500;
  const message = normalizedError.message || "Server error";

  if (status >= 500) {
    console.error(normalizedError);
  }

  return jsonError(message, status);
}
