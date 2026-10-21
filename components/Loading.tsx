"use client";
import { useEffect } from "react";
type SpinnerProps = { label?: string; size?: "small" | "medium" | "large" };

function notifyLoading(active: boolean) {
  window.dispatchEvent(new CustomEvent("nestling:loading", { detail: { active } }));
}

export function Spinner({ label = "Loading", size = "medium" }: SpinnerProps) {
  return <span className={`loading-spinner loading-spinner-${size}`} role="status" aria-label={label}><span className="sr-only">{label}</span></span>;
}

export function ButtonContent({ busy, children, busyLabel = "Processing..." }: { busy?: boolean; children: React.ReactNode; busyLabel?: string }) {
  useEffect(() => {
    if (!busy) return;
    notifyLoading(true);
    return () => notifyLoading(false);
  }, [busy]);
  return <>{busy && <Spinner size="small" label={busyLabel}/>}<span>{busy ? busyLabel : children}</span></>;
}

export function LoadingBlock({ label = "Loading...", compact = false }: { label?: string; compact?: boolean }) {
  return <div className={`loading-block${compact ? " loading-block-compact" : ""}`} role="status" aria-live="polite"><Spinner size={compact ? "small" : "medium"}/><span>{label}</span></div>;
}

export function PageLoader({ label = "Loading Musa Traders..." }: { label?: string }) {
  return <main className="page-loader" aria-busy="true"><div className="page-loader-card"><span className="page-loader-mark" aria-hidden="true">N</span><LoadingBlock label={label}/></div></main>;
}
