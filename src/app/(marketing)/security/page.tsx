import type { Metadata } from "next";
import { Notice } from "@/components/ui/misc";

export const metadata: Metadata = { title: "Security and privacy limits" };

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="border-t border-border py-10 first:border-0">
    <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
    <div className="mt-3 space-y-3 text-[15px] leading-7 text-muted-fg">{children}</div>
  </section>
);

export default function Security() {
  return (
    <article className="mx-auto max-w-2xl px-5 py-20">
      <h1 className="text-4xl font-semibold tracking-[-0.03em]">Security and privacy limits</h1>
      <p className="mt-4 text-lg leading-8 text-muted-fg">What Quorum does, what it doesn&apos;t, and where trust still rests with whoever runs the server.</p>
      <Notice tone="warn" className="mt-8" title="Not certified for regulated elections">
        Quorum hasn&apos;t been independently audited or certified. Don&apos;t use it for elections governed by law, regulation or a binding legal standard.
      </Notice>

      <div className="mt-10">
        <Section title="What is protected">
          <p>Ballots are stored with a random ID and no reference to the voter, the voter list, the pass used to vote or the time of voting. Attendance and pass times are recorded only to the hour. Voter identifiers on the list are stored as keyed hashes, and labels and staged import rows are encrypted. Passes are random, single-use, short-lived and stored only as hashes.</p>
          <p>Ballots, selections and the audit log can&apos;t be edited or deleted through the application, and the database setup includes guards that refuse it as well. The voter list can&apos;t change in the 24 hours before voting. Results and analytics are withheld by the server, not just hidden on screen, until your chosen policy allows them.</p>
        </Section>
        <Section title="What is not protected">
          <p>Anyone with direct access to the database, its backups or the server&apos;s logs, and with the application secret, may be able to narrow down how someone voted, for example by comparing the physical order in which rows were written with the order people checked in. We reduce this (no timestamps on ballots, hour-level attendance, random IDs) but can&apos;t remove it.</p>
          <p>Very small elections reveal more: with three voters, a tally can reveal individual choices. If everyone voted the same way, so did you. Open-access elections only limit one ballot per browser, which anyone can get around by clearing cookies.</p>
          <p>The organizer sees who has voted, not what they chose. Quorum can&apos;t stop a voter from being coerced, or from showing their screen to someone else.</p>
        </Section>
        <Section title="How counting works">
          <p>Plurality: each selected candidate gets one vote, and the candidates with the most votes fill the seats. Ties are reported and never broken silently. The report you download says so.</p>
        </Section>
        <Section title="Where it runs">
          <p>You or your host run the server. The strength of the secrecy promises above depends on who can reach that server&apos;s database and secrets. Read the threat model in the project documentation before relying on it.</p>
        </Section>
      </div>
    </article>
  );
}
