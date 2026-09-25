import Link from "next/link";
import { BrandMark } from "@/components/brand";
import { LandingHero } from "@/components/landing-hero";
import { Reveal } from "@/components/reveal";
import { ThemeToggle } from "@/components/theme-toggle";

const STEPS = [
  { title: "Add your resume", body: "We read your skills, experience and the roles you've held." },
  { title: "Pick companies and places", body: "Paste career pages you care about and choose where you want to work." },
  { title: "Get the shortlist", body: "At 10 AM and 9 PM we email only new jobs that fit, with the reasons why." },
];

export default function Home() {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-[1120px] items-center justify-between px-4 py-5 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
          <BrandMark className="size-7" /> Job Agent
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle className="hidden sm:inline-flex" />
          <Link href="/login" className="inline-flex h-10 items-center rounded-lg px-4 text-sm font-medium hover:bg-surface">
            Sign in
          </Link>
        </div>
      </header>

      <main id="main">
        <LandingHero />

        <section id="how" className="border-t bg-surface">
          <div className="mx-auto max-w-[1120px] px-4 py-16 sm:px-6 lg:py-20">
            <h2 className="text-xl font-semibold tracking-tight">Set it up once. It keeps looking for you.</h2>
            <ol className="mt-10 grid gap-10 sm:grid-cols-3 sm:gap-8">
              {STEPS.map((s, i) => (
                <Reveal as="li" key={s.title} delay={i * 0.1} className="border-t-2 border-ink pt-5">
                  <span className="tabular text-sm font-semibold text-fit">Step {i + 1}</span>
                  <h3 className="mt-2 text-base font-semibold">{s.title}</h3>
                  <p className="mt-1.5 text-sm text-graphite">{s.body}</p>
                </Reveal>
              ))}
            </ol>
            <div className="mt-14 flex flex-col items-start justify-between gap-6 rounded-2xl bg-ink p-8 text-primary-foreground sm:flex-row sm:items-center dark:border dark:border-fit/25 dark:bg-fit-soft dark:text-ink">
              <p className="max-w-lg text-lg font-medium leading-snug">No scrolling through job boards. No repeats. Only openings that fit.</p>
              <Link href="/login" className="inline-flex h-12 shrink-0 items-center rounded-lg bg-paper px-6 text-base font-medium text-ink hover:bg-paper/90 dark:bg-fit dark:text-paper dark:hover:bg-fit/90">
                Create your shortlist
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-[1120px] flex-col gap-3 px-4 py-8 text-sm text-graphite sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="flex items-center gap-2">
          <BrandMark className="size-5" /> Job Agent
        </p>
        <p>Your resume stays private and encrypted. Delete it any time.</p>
      </footer>
    </div>
  );
}
