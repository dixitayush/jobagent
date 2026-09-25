"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, XCircle } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import { ValidateSourceInput, type SourceValidation } from "@jobagent/shared";
import { ApiError, post } from "@/lib/api";
import { keys } from "@/lib/queries";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import { FieldError, Input, Label } from "./ui/input";

/** PRD §12: add a career page → Validate → Save. */
export function SourceForm({ onSaved }: { onSaved?: () => void }) {
  const qc = useQueryClient();
  const [validation, setValidation] = useState<SourceValidation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const form = useForm<ValidateSourceInput>({ resolver: zodResolver(ValidateSourceInput), defaultValues: { companyName: "", sourceUrl: "" } });
  const { register, handleSubmit, formState, watch, reset } = form;
  const url = watch("sourceUrl");

  const validate = handleSubmit(async (v) => {
    setError(null);
    setValidating(true);
    try {
      setValidation(await post<SourceValidation>("/sources/validate", v));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Validation failed");
    } finally {
      setValidating(false);
    }
  });

  const save = handleSubmit(async (v) => {
    setError(null);
    try {
      await post("/sources", v);
      await qc.invalidateQueries({ queryKey: keys.sources });
      void qc.invalidateQueries({ queryKey: keys.overview });
      reset();
      setValidation(null);
      onSaved?.();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save source");
    }
  });

  return (
    <form className="space-y-4" onSubmit={save} noValidate>
      <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
        <div className="space-y-1.5">
          <Label htmlFor="companyName">Company name</Label>
          <Input id="companyName" placeholder="Stripe" aria-invalid={!!formState.errors.companyName} {...register("companyName")} />
          <FieldError message={formState.errors.companyName?.message} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sourceUrl">Career page URL</Label>
          <Input
            id="sourceUrl"
            type="url"
            inputMode="url"
            placeholder="https://boards.greenhouse.io/stripe"
            aria-invalid={!!formState.errors.sourceUrl}
            {...register("sourceUrl", { onChange: () => setValidation(null) })}
          />
          <FieldError message={formState.errors.sourceUrl ? "Enter a full URL starting with https://" : undefined} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Works best with Greenhouse, Lever, Ashby, SmartRecruiters and Workday boards. Other career pages are read through their structured job data.</p>

      {validation && (
        <div className="rounded-lg border p-4" aria-live="polite">
          <ul className="space-y-1.5 text-sm">
            {validation.checks.map((c) => (
              <li key={c.label} className="flex items-start gap-2">
                {c.ok ? <CheckCircle2 className="mt-0.5 size-4 text-fit" aria-label="Passed" /> : <XCircle className="mt-0.5 size-4 text-destructive" aria-label="Failed" />}
                <span>
                  <span className="font-medium">{c.label}</span>
                  {c.detail && <span className="text-muted-foreground"> — {c.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
          {validation.sampleTitles.length > 0 && <p className="mt-3 text-xs text-graphite">Openings found include {validation.sampleTitles.slice(0, 3).join(", ")}.</p>}
        </div>
      )}
      {error && <Alert tone="error">{error}</Alert>}

      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={validate} loading={validating} disabled={!url}>
          Validate
        </Button>
        <Button type="submit" loading={formState.isSubmitting} disabled={!validation?.ok}>
          Save
        </Button>
      </div>
    </form>
  );
}
