import Link from "next/link";
import type { ReactNode } from "react";
import { ConfirmLink } from "./confirm-link";

/**
 * The floating "pill" header used on every full-bleed map screen (map, route detail, route builder,
 * paddle summary): a back link, an optional divider + title, and optional trailing content -- all in
 * a translucent rounded pill pinned to the top-safe-area. Extracted once this exact markup showed up
 * in four different pages so the app reads as one product instead of four bespoke ones.
 */
export function FloatingHeader({
  backHref,
  backLabel = "Back",
  title,
  right,
  backConfirm,
}: {
  backHref: string;
  backLabel?: string;
  title?: string;
  right?: ReactNode;
  backConfirm?: string;
}) {
  const backClassName =
    "text-river-700 hover:text-river-900 active:text-river-950 text-sm font-semibold";
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center p-[max(1rem,env(safe-area-inset-top))]">
      <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-white/90 px-4 py-2 shadow-lg backdrop-blur">
        {backConfirm ? (
          <ConfirmLink
            href={backHref}
            className={backClassName}
            confirmMessage={backConfirm}
          >
            ← {backLabel}
          </ConfirmLink>
        ) : (
          <Link href={backHref} className={backClassName}>
            ← {backLabel}
          </Link>
        )}
        {title ? (
          <>
            <span className="text-river-200">|</span>
            <span className="text-river-900 max-w-[14rem] truncate text-sm font-medium">
              {title}
            </span>
          </>
        ) : null}
        {right}
      </div>
    </div>
  );
}
