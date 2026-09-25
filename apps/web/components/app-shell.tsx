"use client";

import { Bell, Bookmark, Briefcase, Building2, FileText, LayoutDashboard, LogOut, Menu, Settings, Shield, SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, post } from "@/lib/api";
import { useMe } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { Skeleton } from "./ui/skeleton";

const NAV = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/jobs", label: "Job feed", icon: Briefcase },
  { href: "/saved", label: "Saved jobs", icon: Bookmark },
  { href: "/resume", label: "Resume & profile", icon: FileText },
  { href: "/preferences", label: "Preferences", icon: SlidersHorizontal },
  { href: "/sources", label: "Sources", icon: Building2 },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/settings", label: "Account & privacy", icon: Settings },
];

export function AppShell({ children }: { children: ReactNode }) {
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    else if (me.data && !me.data.onboardingCompleted && pathname !== "/onboarding") router.replace("/onboarding");
  }, [me.error, me.data, pathname, router]);

  useEffect(() => setOpen(false), [pathname]);

  if (!me.data) {
    return (
      <div className="container flex min-h-dvh items-center justify-center" aria-busy>
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }

  const logout = async () => {
    await post("/auth/logout").catch(() => undefined);
    qc.clear();
    router.replace("/login");
  };

  const nav = [...NAV, ...(me.data.role === "admin" ? [{ href: "/admin", label: "Admin", icon: Shield }] : [])];
  const links = (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {nav.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn("flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors", active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground")}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="hidden border-r lg:flex lg:flex-col lg:gap-6 lg:p-4">
        <Link href="/dashboard" className="px-3 pt-2 text-lg font-semibold tracking-tight">
          AI Job Agent
        </Link>
        {links}
        <div className="mt-auto flex items-center gap-3 border-t px-3 pt-4">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{me.data.name}</p>
            <p className="truncate text-xs text-muted-foreground">{me.data.email}</p>
          </div>
          <button onClick={logout} className="rounded-md p-2 text-muted-foreground hover:bg-accent" aria-label="Sign out">
            <LogOut className="size-4" />
          </button>
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex items-center justify-between border-b bg-background/95 px-4 py-3 backdrop-blur lg:hidden">
        <Link href="/dashboard" className="font-semibold">
          AI Job Agent
        </Link>
        <button onClick={() => setOpen((o) => !o)} className="rounded-md p-2 hover:bg-accent" aria-expanded={open} aria-controls="mobile-nav" aria-label={open ? "Close menu" : "Open menu"}>
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </header>
      {open && (
        <div id="mobile-nav" className="border-b bg-background p-4 lg:hidden">
          {links}
          <button onClick={logout} className="mt-3 flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent">
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      )}

      <main id="main" className="min-w-0 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
