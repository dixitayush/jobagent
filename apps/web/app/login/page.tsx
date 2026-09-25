"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import Script from "next/script";
import { Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { Me } from "@jobagent/shared";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    <main id="main" className="container flex min-h-dvh max-w-md items-center py-12">
      {config.data?.googleClientId && <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onLoad={() => setGsiReady(true)} />}
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-xl">Sign in to AI Job Agent</CardTitle>
          <CardDescription>Use your Google account. We only read your name, email and profile picture.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {config.data?.googleClientId ? (
            <div ref={button} className="flex min-h-11 justify-center" />
          ) : (
            config.data && <Alert tone="warning" title="Google sign-in is not configured">Set GOOGLE_CLIENT_ID in .env to enable it.</Alert>
          )}
          {config.data?.devLoginEnabled && (
            <form onSubmit={devLogin} className="space-y-3 border-t pt-5">
              <p className="text-sm font-medium">Local development sign-in</p>
              <div className="space-y-1.5">
                <Label htmlFor="dev-name">Name</Label>
                <Input id="dev-name" name="name" required defaultValue="Ayush Dixit" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dev-email">Email</Label>
                <Input id="dev-email" name="email" type="email" required defaultValue="dev@example.com" />
              </div>
              <Button type="submit" variant="secondary" className="w-full" loading={busy}>
                Continue
              </Button>
            </form>
          )}
          {error && <Alert tone="error">{error}</Alert>}
        </CardContent>
      </Card>
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
