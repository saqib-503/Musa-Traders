"use client";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { Spinner } from "./Loading";

export default function TopLoader() {
  const pathname = usePathname();
  const hideTimer = useRef<number | null>(null);
  useEffect(() => {
    const show = () => {
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
      document.documentElement.dataset.nestlingLoading = "true";
    };
    const hide = (delay = 500) => {
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => { delete document.documentElement.dataset.nestlingLoading; }, delay);
    };
    const activity = (event: Event) => ((event as CustomEvent<{active:boolean}>).detail.active ? show() : hide());
    const navigation = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest("a[href]") as HTMLAnchorElement | null;
      if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target || link.hasAttribute("download")) return;
      const destination = new URL(link.href, window.location.href);
      if (destination.origin === window.location.origin && (destination.pathname !== window.location.pathname || destination.search !== window.location.search)) {
        show();
        window.setTimeout(() => hide(0), 8000);
      }
    };
    window.addEventListener("nestling:loading", activity);
    document.addEventListener("click", navigation, true);
    return () => { if (hideTimer.current !== null) window.clearTimeout(hideTimer.current); delete document.documentElement.dataset.nestlingLoading; window.removeEventListener("nestling:loading", activity); document.removeEventListener("click", navigation, true); };
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { delete document.documentElement.dataset.nestlingLoading; }, 500);
    return () => window.clearTimeout(timer);
  }, [pathname]);
  return <div className="top-loader" role="status" aria-live="polite"><Spinner size="medium" label="Loading"/><span>Loading</span></div>;
}
