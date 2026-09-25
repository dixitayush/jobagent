"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Script from "next/script";
import { BrandMark } from "@/components/brand";
import { Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { Me } from "@jobagent/shared";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { ApiError, post } from "@/lib/api";
import { keys, useAuthConfig } from "@/lib/queries";

interface GoogleId {
  accounts: {
    id: {
      initialize(o: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: string }): void;
      renderButton(el: HTMLElement, o: Record<string, unknown>): void;
    };
  };
}
declare global {
  interface Window {
    google?: GoogleId;
  }
}

function LoginInner() {
  const config = useAuthConfig();
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const button = useRef<HTMLDivElement>(null);
  const [gsiReady, setGsiReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const finish = useCallback(
    (me: Me) => {
      qc.setQueryData(keys.me, me);
      const next = params.get("next");
      router.replace(!me.onboardingCompleted ? "/onboarding" : next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
    },
    [params, qc, router],
  );

  useEffect(() => {
    const clientId = config.data?.googleClientId;
    if (!gsiReady || !clientId || !window.google || !button.current) return;
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: async ({ credential }) => {
        setError(null);
        try {
          finish(await post<Me>("/auth/google", { credential }));
        } catch (e) {
          setError(e instanceof ApiError ? e.message : "Sign-in failed");
        }
      },
    });
    window.google.accounts.id.renderButton(button.current, { theme: "outline", size: "large", text: "signin_with", shape: "rectangular", width: 320 });
  }, [gsiReady, config.data, finish]);

  const devLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      finish(await post<Me>("/auth/dev", { email: f.get("email"), name: f.get("name") }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      {config.data?.googleClientId && <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onLoad={() => setGsiReady(true)} />}
      <Link href="/" className="mb-8 flex items-center gap-2.5 font-semibold tracking-tight">
        <BrandMark className="size-8" /> Job Agent
      </Link>
      <div className="w-full max-w-sm rounded-2xl border bg-surface p-6 sm:p-8">
        <h1 className="text-lg font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1.5 text-sm text-graphite">Use your Google account. We only read your name, email and photo.</p>
        <div className="mt-6 space-y-6">
          {config.data?.googleClientId ? (
            <div ref={button} className="flex min-h-11 justify-center" />
          ) : (
            config.data && (
              <Alert tone="warning" title="Google sign-in isn't set up">
                Add GOOGLE_CLIENT_ID to .env to turn it on.
              </Alert>
            )
          )}
          {config.data?.devLoginEnabled && (
            <form onSubmit={devLogin} className="space-y-3 border-t pt-6">
              <p className="text-sm font-medium">Local development sign-in</p>
              <div className="space-y-1.5">
                <Label htmlFor="dev-name">Name</Label>
                <Input id="dev-name" name="name" required defaultValue="Ayush Dixit" autoComplete="name" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dev-email">Email</Label>
                <Input id="dev-email" name="email" type="email" required defaultValue="dev@example.com" autoComplete="email" />
              </div>
              <Button type="submit" variant="outline" className="w-full" loading={busy}>
                Continue
              </Button>
            </form>
          )}
          {error && <Alert tone="error">{error}</Alert>}
        </div>
      </div>
      <p className="mt-6 max-w-sm text-center text-xs text-graphite">Your resume is stored encrypted and never shared. You can delete your data at any time.</p>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
