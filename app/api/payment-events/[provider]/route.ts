import { errorResponse } from "@/lib/server/http";
import { ApiError } from "@/lib/server/errors";
import { paymentAdapter, processPaymentEvent } from "@/lib/server/wallet";

/**
 * POST /api/payment-events/:provider — signed provider callbacks. Never trusts client success messages.
 * Deduplicated by provider event ID inside processPaymentEvent.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/payment-events/[provider]">) {
  const { provider } = await ctx.params;
  try {
    if (provider !== paymentAdapter.id) throw new ApiError(404, "NOT_FOUND", "Unknown provider");
    const raw = await req.text();
    let event;
    try {
      event = paymentAdapter.validateAndNormalizeEvent(raw, req.headers.get("x-signature"));
    } catch {
      throw new ApiError(401, "UNAUTHENTICATED", "Invalid payment event signature");
    }
    return Response.json(processPaymentEvent(event));
  } catch (e) {
    return errorResponse(e);
  }
}
