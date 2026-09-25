"use client";

import { X } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";

/** Free-text multi-value input (job titles, companies, skills). Enter or comma adds a value. */
export function TagInput({ id, value, onChange, placeholder, suggestions = [], max = 50 }: { id: string; value: string[]; onChange: (v: string[]) => void; placeholder?: string; suggestions?: string[]; max?: number }) {
  const [draft, setDraft] = useState("");
  const add = (raw: string) => {
    const v = raw.trim().replace(/,$/, "");
    if (!v || value.some((x) => x.toLowerCase() === v.toLowerCase()) || value.length >= max) return;
    onChange([...value, v]);
    setDraft("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(draft);
    } else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
  };
  const open = suggestions.filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase()));
  return (
    <div className="space-y-2">
      <Input id={id} value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onBlur={() => add(draft)} aria-describedby={`${id}-hint`} />
      <p id={`${id}-hint`} className="sr-only">
        Press Enter to add. Backspace removes the last value.
      </p>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {value.map((v) => (
            <li key={v}>
              <Badge className="gap-1 py-1 pl-3 pr-1.5 text-sm">
                {v}
                <button type="button" onClick={() => onChange(value.filter((x) => x !== v))} className="rounded-full p-0.5 hover:bg-accent" aria-label={`Remove ${v}`}>
                  <X className="size-3.5" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      {open.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <span className="text-xs text-muted-foreground">Suggestions:</span>
          {open.slice(0, 8).map((s) => (
            <button key={s} type="button" onClick={() => add(s)} className="rounded-full border px-2 py-0.5 text-xs hover:bg-accent">
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
