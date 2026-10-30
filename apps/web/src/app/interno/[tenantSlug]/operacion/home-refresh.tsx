"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const refreshMs = 10_000;

/** Keeps the call counter of the staff home current while the page is on screen. */
export function HomeRefresh() {
  const router = useRouter();
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, refreshMs);
    return () => window.clearInterval(timer);
  }, [router]);
  return null;
}
