import { ArrowRight, Filter, Mail, Radar, Sparkles } from "lucide-react";
import Link from "next/link";

const STEPS = [
  { icon: Radar, title: "Discovers new openings", body: "Tracks the career pages you care about and finds jobs as soon as they open." },
  { icon: Filter, title: "Filters what doesn't fit", body: "Location, experience, work mode and employment type are checked before anything else." },
  { icon: Sparkles, title: "Matches against your resume", body: "Every job gets a match level, a score and a plain-language explanation." },
  { icon: Mail, title: "Emails the best ones", body: "A short digest at 10:00 AM and 9:00 PM in your timezone. Only new jobs." },
];

export default function Home() {
  return (
    <main id="main" className="container max-w-5xl py-16 sm:py-24">
      <p className="text-sm font-medium text-muted-foreground">AI Job Agent</p>
      <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">An AI recruiter that finds the few new jobs worth your time.</h1>
      <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
        Upload your resume, pick your locations and companies. The agent searches every day, ranks what it finds against your profile, and emails you the strongest matches.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/login" className="inline-flex h-11 items-center gap-2 rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          Get started <ArrowRight className="size-4" aria-hidden />
        </Link>
        <Link href="/dashboard" className="inline-flex h-11 items-center rounded-md border px-6 text-sm font-medium hover:bg-accent">
          Open dashboard
        </Link>
      </div>
      <ul className="mt-16 grid gap-6 sm:grid-cols-2">
        {STEPS.map(({ icon: Icon, title, body }) => (
          <li key={title} className="rounded-lg border p-5">
            <Icon className="size-5" aria-hidden />
            <h2 className="mt-3 font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{body}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
