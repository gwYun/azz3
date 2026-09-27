"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/lib/toast-context";
import { useT } from "@/lib/i18n-context";

/**
 * Surfaces the `?auth=` notice that app/auth/callback/route.ts appends
 * (`canceled` | `error`) as a toast, then strips the param so a refresh does
 * not re-fire it.
 *
 * Mounted inside a <Suspense> boundary in the root layout: useSearchParams()
 * bails out to client rendering up to the nearest Suspense boundary, so
 * wrapping it here keeps the static public pages static.
 */
export function AuthNotice() {
  const t = useT();
  const { show } = useToast();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const shown = useRef(false);

  const auth = params.get("auth");

  useEffect(() => {
    if (!auth || shown.current) return;
    shown.current = true;

    if (auth === "canceled") show(t("auth.canceled"));
    else if (auth === "error") show(t("auth.error"));

    const rest = new URLSearchParams(params);
    rest.delete("auth");
    const qs = rest.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }, [auth, params, pathname, router, show, t]);

  return null;
}
