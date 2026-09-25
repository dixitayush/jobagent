"use client";

import { Upload } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Resume } from "@jobagent/shared";
import { api, ApiError } from "@/lib/api";
import { keys } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { Alert } from "./ui/alert";

const ACCEPT = ".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain";

export function ResumeUpload({ onUploaded, compact }: { onUploaded?: (r: Resume) => void; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setError(null);
    if (file.size > 5 * 1024 * 1024) return setError("File is larger than 5 MB.");
    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const r = await api<Resume>("/resumes", { method: "POST", body });
      await qc.invalidateQueries({ queryKey: keys.resumes });
      onUploaded?.(r);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files[0];
    if (f) void upload(f);
  };

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => (e.preventDefault(), setDrag(true))}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        className={cn("flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed text-center transition-colors", compact ? "p-5" : "p-10", drag ? "border-primary bg-accent" : "border-input")}
      >
        <Upload className="size-6 text-muted-foreground" aria-hidden />
        <div>
          <p className="text-sm font-medium">{busy ? "Uploading…" : "Drop your resume here"}</p>
          <p className="text-xs text-graphite">PDF, DOCX or TXT, up to 5 MB. Stored encrypted.</p>
        </div>
        <label className={cn("inline-flex h-9 cursor-pointer items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-within:ring-2 focus-within:ring-ring", busy && "pointer-events-none opacity-50")}>
          Choose file
          <input ref={input} type="file" accept={ACCEPT} className="sr-only" disabled={busy} onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
        </label>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}
