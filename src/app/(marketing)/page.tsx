import { Check, ClipboardList, Eye, FileClock, Lock, ScrollText, ShieldAlert } from "lucide-react";
import { HeroBallot } from "@/components/marketing/hero-ballot";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { LinkButton } from "@/components/ui/button";

const principles = [
  { icon: Lock, title: "Ballots carry no name", body: "A ballot is stored with a random ID and no link to the voter, the voter list or the time it was cast. Attendance is recorded separately, to the hour. The security page lists what this does not protect against." },
  { icon: FileClock, title: "The list locks 24 hours early", body: "Eligible voters can be added or removed only until 24 hours before voting starts. Rescheduling never reopens a frozen list." },
  { icon: Check, title: "One voter, one ballot", body: "Each voter gets a single-use pass that expires. Two people can’t spend one pass, and one person can’t spend two, even at the same instant." },
  { icon: Eye, title: "Results appear when you say", body: "Choose live, after close, or on publish. The rule is enforced on the server for every screen, API call and download, so hidden means hidden." },
  { icon: ScrollText, title: "Every admin action is logged", body: "Who changed the ballot, opened voting or downloaded a report is recorded in an append-only log the database itself refuses to edit." },
  { icon: ShieldAlert, title: "Clear about its limits", body: "Quorum suits clubs, societies, unions and associations. It isn’t certified for statutory or regulated elections, and says so." },
];

export default function Home() {
  return (
    <>
      <section className="mx-auto grid max-w-6xl items-center gap-14 px-5 pb-24 pt-16 sm:pt-24 lg:grid-cols-[1.15fr_1fr]">
        <div>
          <h1 className="q-rise max-w-2xl text-[clamp(2.4rem,5.4vw,4rem)] font-semibold leading-[1.04] tracking-[-0.035em]">Run an election your members can trust.</h1>
          <p className="q-rise mt-6 max-w-xl text-lg leading-8 text-muted-fg" style={{ animationDelay: ".05s" }}>Build a ballot, import your voter list and open voting. Quorum keeps ballots separate from voter records, counts every ballot once, and shows turnout and results exactly when you decide.</p>
          <div className="q-rise mt-9 flex flex-wrap items-center gap-3" style={{ animationDelay: ".1s" }}>
            <LinkButton href="/sign-up" size="lg">Create an election</LinkButton>
            <LinkButton href="/#how" size="lg" variant="secondary">See how it works</LinkButton>
          </div>
          <p className="q-rise mt-5 text-sm text-muted-fg" style={{ animationDelay: ".15s" }}>Free to try. No card needed.</p>
        </div>
        <HeroBallot />
      </section>

      <section id="how" className="scroll-mt-20 border-y border-border bg-card/40">
        <div className="mx-auto max-w-6xl px-5 py-24">
          <h2 className="max-w-xl text-3xl font-semibold tracking-[-0.025em] sm:text-4xl">Four steps, start to finish.</h2>
          <p className="mt-3 max-w-lg text-[17px] leading-7 text-muted-fg">Everything an organizer does happens in this order. Pick a step to see what it involves.</p>
          <div className="mt-12"><HowItWorks /></div>
        </div>
      </section>

      <section id="principles" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-24">
        <h2 className="max-w-xl text-3xl font-semibold tracking-[-0.025em] sm:text-4xl">What we hold ourselves to.</h2>
        <p className="mt-3 max-w-lg text-[17px] leading-7 text-muted-fg">Plain commitments, each one enforced in code and covered by tests.</p>
        <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {principles.map((p) => (
            <li key={p.title} className="flex flex-col rounded-xl border border-border bg-card p-6 transition-colors hover:border-muted-fg/40">
              <p.icon className="size-5 text-muted-fg" aria-hidden />
              <h3 className="mt-5 text-[17px] font-semibold tracking-tight">{p.title}</h3>
              <p className="mt-2 text-[15px] leading-6 text-muted-fg">{p.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mx-auto max-w-6xl px-5">
        <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
          <div className="rounded-2xl border border-border bg-primary p-8 text-primary-fg sm:p-12">
            <h2 className="max-w-md text-3xl font-semibold leading-tight tracking-[-0.025em] sm:text-4xl">Ready to set up your first election?</h2>
            <p className="mt-4 max-w-md text-[17px] leading-7 opacity-75">It takes about ten minutes if you have your candidates and voter list to hand.</p>
            <ul className="mt-8 space-y-3 text-[15px]">
              {["Names of the positions and candidates", "Voter list as a CSV file (or paste it in)", "A start and end time for voting"].map((t) => (
                <li key={t} className="flex items-center gap-3"><Check className="size-4 shrink-0 opacity-70" aria-hidden />{t}</li>
              ))}
            </ul>
            <LinkButton href="/sign-up" size="lg" variant="secondary" className="mt-10 border-transparent">Get started</LinkButton>
          </div>
          <aside className="flex flex-col self-start rounded-2xl border border-border bg-card p-8 sm:p-10" aria-label="Who it is for">
            <div>
              <ClipboardList className="size-5 text-muted-fg" aria-hidden />
              <h3 className="mt-5 text-xl font-semibold tracking-tight">A good fit for</h3>
              <p className="mt-2 text-[15px] leading-6 text-muted-fg">Clubs, societies, unions, residents’ associations, co-ops, student councils and alumni groups.</p>
            </div>
            <div className="mt-10 border-t border-border pt-6">
              <h3 className="text-xl font-semibold tracking-tight">Not a fit for</h3>
              <p className="mt-2 text-[15px] leading-6 text-muted-fg">Elections governed by law or regulation. Quorum isn’t certified and hasn’t been independently audited. <a className="text-fg underline underline-offset-4 decoration-border hover:decoration-fg" href="/security">Read the limits.</a></p>
            </div>
          </aside>
        </div>
      </section>
    </>
  );
}
