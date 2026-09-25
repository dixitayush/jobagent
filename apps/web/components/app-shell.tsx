"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Bell, Bookmark, Briefcase, Building2, FileText, Home, LogOut, Menu, Settings, Shield, SlidersHorizontal } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { ApiError, post } from "@/lib/api";
import { useMe } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { BrandMark } from "./brand";
import { ThemeToggle } from "./theme-toggle";
import { Sheet } from "./ui/sheet";
import { Skeleton } from "./ui/skeleton";

interface NavItem {
  href: string;
  label: string;
  icon: typeof Home;
}

const GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Today",
    items: [
      { href: "/dashboard", label: "Overview", icon: Home },
      { href: "/jobs", label: "Job feed", icon: Briefcase },
      { href: "/saved", label: "Saved", icon: Bookmark },
    ],
  },
  {
    label: "Your search",
    items: [
      { href: "/resume", label: "Resume & profile", icon: FileText },
      { href: "/preferences", label: "Preferences", icon: SlidersHorizontal },
      { href: "/sources", label: "Companies", icon: Building2 },
    ],
  },
  {
    label: "Account",
    items: [
      { href: "/notifications", label: "Email digests", icon: Bell },
      { href: "/settings", label: "Account & privacy", icon: Settings },
    ],
  },
];

const MOBILE_TABS: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: Home },
  { href: "/jobs", label: "Jobs", icon: Briefcase },
  { href: "/saved", label: "Saved", icon: Bookmark },
  { href: "/sources", label: "Companies", icon: Building2 },
];

const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

function NavLink({ item, pathname, layoutGroup }: { item: NavItem; pathname: string; layoutGroup: string }) {
  const active = isActive(pathname, item.href);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn("relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors", active ? "font-medium text-ink" : "text-graphite hover:bg-surface/60 hover:text-ink")}
    >
      {/* The active highlight glides between items as you navigate. */}
      {active && <motion.span layoutId={`nav-active-${layoutGroup}`} className="absolute inset-0 rounded-lg bg-surface shadow-[inset_0_0_0_1px_hsl(var(--rule))]" transition={{ type: "spring", stiffness: 500, damping: 38 }} aria-hidden />}
      <Icon className={cn("relative size-4 transition-colors", active && "text-fit")} aria-hidden />
      <span className="relative">{item.label}</span>
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const [more, setMore] = useState(false);

  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    else if (me.data && !me.data.onboardingCompleted && pathname !== "/onboarding") router.replace("/onboarding");
  }, [me.error, me.data, pathname, router]);
  useEffect(() => setMore(false), [pathname]);

  if (!me.data) {
    return (
      <div className="flex min-h-dvh items-center justify-center" aria-busy>
        <Skeleton className="h-6 w-40" />
      </div>
    );
  }

  const logout = async () => {
    await post("/auth/logout").catch(() => undefined);
    qc.clear();
    router.replace("/login");
  };
  const groups = me.data.role === "admin" ? [...GROUPS.slice(0, 2), { ...GROUPS[2]!, items: [...GROUPS[2]!.items, { href: "/admin", label: "Admin", icon: Shield }] }] : GROUPS;
  const initials = me.data.name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

  const renderNav = (layoutGroup: string) => (
    <nav aria-label="Main" className="flex flex-col gap-6">
      {groups.map((g) => (
        <div key={g.label}>
          <p className="mb-1.5 px-3 text-xs font-medium text-graphite">{g.label}</p>
          <div className="flex flex-col gap-0.5">
            {g.items.map((item) => (
              <NavLink key={item.href} item={item} pathname={pathname} layoutGroup={layoutGroup} />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );

  const account = (
    <div className="flex items-center gap-3">
      <div className="grid size-9 shrink-0 place-items-center rounded-full bg-ink text-xs font-semibold text-primary-foreground" aria-hidden>
        {initials}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{me.data.name}</p>
        <p className="truncate text-xs text-graphite">{me.data.email}</p>
      </div>
      <button onClick={logout} className="grid size-9 place-items-center rounded-lg text-graphite hover:bg-surface hover:text-ink" aria-label="Sign out" title="Sign out">
        <LogOut className="size-4" />
      </button>
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[256px_1fr]">
      {/* Desktop rail */}
      <aside className="sticky top-0 hidden h-dvh flex-col gap-8 border-r px-3 py-5 lg:flex">
        <Link href="/dashboard" className="flex items-center gap-2.5 px-3 text-base font-semibold tracking-tight">
          <BrandMark className="size-7" /> Job Agent
        </Link>
        <div className="flex-1 overflow-y-auto">{renderNav("rail")}</div>
        <div className="flex flex-col gap-4 border-t px-3 pt-4">
          <ThemeToggle className="self-start" />
          {account}
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b bg-paper/90 px-4 py-3 backdrop-blur lg:hidden">
        <Link href="/dashboard" className="flex items-center gap-2 font-semibold tracking-tight">
          <BrandMark className="size-6" /> Job Agent
        </Link>
        <ThemeToggle />
      </header>

      <main id="main" className="min-w-0 px-4 pb-28 pt-6 sm:px-6 lg:px-12 lg:pb-12 lg:pt-10">
        <div className="mx-auto max-w-[1120px]">{children}</div>
      </main>

      {/* Mobile bottom tabs */}
      <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        {MOBILE_TABS.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link key={href} href={href} aria-current={active ? "page" : undefined} className={cn("relative flex flex-col items-center gap-1 py-2.5 text-[11px] transition-colors", active ? "font-medium text-ink" : "text-graphite")}>
              {active && <motion.span layoutId="tab-active" className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-fit" transition={{ type: "spring", stiffness: 500, damping: 38 }} aria-hidden />}
              <Icon className={cn("size-5 transition-colors", active && "text-fit")} aria-hidden />
              {label}
            </Link>
          );
        })}
        <button type="button" onClick={() => setMore(true)} aria-expanded={more} aria-controls="more-sheet" className="flex flex-col items-center gap-1 py-2.5 text-[11px] text-graphite">
          <Menu className="size-5" aria-hidden />
          More
        </button>
      </nav>

      <Sheet open={more} onClose={() => setMore(false)} title="Menu" id="more-sheet" footer={account}>
        {renderNav("sheet")}
      </Sheet>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        <h1 className="text-xl font-semibold tracking-tight sm:text-[2rem] sm:leading-[2.4rem]">{title}</h1>
        {description && <p className="mt-2 text-sm text-graphite">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-start gap-2">{actions}</div>}
    </div>
  );
}
