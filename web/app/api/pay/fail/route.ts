import { handleTerminal } from "@/lib/pay-terminal";

/** Kakao Pay fail_url redirect. */
export function GET(request: Request) {
  return handleTerminal(request, "failed", "fail");
}
