import { handleTerminal } from "@/lib/pay-terminal";

/** Kakao Pay cancel_url redirect. */
export function GET(request: Request) {
  return handleTerminal(request, "canceled", "canceled");
}
