"use client";

import Link from "next/link";
import type { ReactNode } from "react";

/**
 * A wrapper around next/link that shows a confirmation dialog before navigation.
 * Useful for preventing accidental navigation away from unsaved work.
 */
export function ConfirmLink({
  href,
  className,
  children,
  "aria-label": ariaLabel,
  confirmMessage,
}: {
  href: string;
  className?: string;
  children: ReactNode;
  "aria-label"?: string;
  confirmMessage?: string;
}) {
  return (
    <Link
      href={href}
      className={className}
      aria-label={ariaLabel}
      onClick={(e) => {
        if (confirmMessage && !window.confirm(confirmMessage)) {
          e.preventDefault();
        }
      }}
    >
      {children}
    </Link>
  );
}
