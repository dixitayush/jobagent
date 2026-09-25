import Link from "next/link";
import { BrandMark } from "@/components/brand";

export default function NotFound() {
  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <BrandMark className="size-10" />
      <h1 className="mt-6 text-xl font-semibold tracking-tight">This page doesn't exist</h1>
      <p className="mt-2 max-w-sm text-sm text-graphite">The link may be old, or the job may have been removed by the company.</p>
      <Link href="/dashboard" className="mt-6 inline-flex h-10 items-center rounded-lg bg-ink px-4 text-sm font-medium text-primary-foreground hover:bg-ink/85">
        Go to overview
      </Link>
    </main>
  );
}
