"use client";

import { useEffect } from "react";
import { BrandMark } from "@/components/brand";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <BrandMark className="size-10" />
      <h1 className="mt-6 text-xl font-semibold tracking-tight">Something went wrong on this page</h1>
      <p className="mt-2 max-w-sm text-sm text-graphite">Your data is safe. Try again, and if it keeps happening, reload the page.</p>
      <button onClick={reset} className="mt-6 inline-flex h-10 items-center rounded-lg bg-ink px-4 text-sm font-medium text-primary-foreground hover:bg-ink/85">
        Try again
      </button>
    </main>
  );
}
