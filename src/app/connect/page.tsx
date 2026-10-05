import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { formatPastMoment } from "@/lib/time";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { ArrowRightIcon, CheckIcon, XIcon } from "@/components/icons";
import { getConnections } from "@/lib/lms/connections";
import { LMS_PROVIDERS, LMS_PROVIDER_INFO, type LmsProvider } from "@/lib/lms/providers";

const HOW: Record<LmsProvider, string> = {
  canvas: "With an access token you make in Canvas's settings.",
  schoology: "With the API key on your school's Schoology /api page.",
  brightspace: "With your Brightspace calendar's subscribe link.",
  blackboard: "With your Blackboard calendar's share link.",
};

function Feature({ yes, children }: { yes: boolean; children: React.ReactNode }) {
  return (
    <li className={`flex items-center gap-2 ${yes ? "text-ink-soft" : "text-ink-faint"}`}>
      {yes ? (
        <CheckIcon className="h-3.5 w-3.5 flex-none text-ok" />
      ) : (
        <XIcon className="h-3.5 w-3.5 flex-none text-ink-faint" />
      )}
      <span className={yes ? "" : "line-through decoration-border"}>{children}</span>
    </li>
  );
}

export default async function ConnectPage() {
  const user = await requireUser();
  const connections = await getConnections(user.id);
  const connected = new Map(connections.map((c) => [c.provider, c]));

  return (
    <AppShell active="/connect" userName={user.name ?? user.email}>
      <PageHeader
        title="Connect your classes"
        description="Pick the system your school uses for classes and assignments. Campus OS only reads from it; it can't submit, change or delete anything there."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {LMS_PROVIDERS.map((provider) => {
          const info = LMS_PROVIDER_INFO[provider];
          const connection = connected.get(provider);
          return (
            <Link
              key={provider}
              href={`/connect/${provider}`}
              className="card card-pad group flex flex-col gap-4 transition-shadow hover:shadow-pop"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-[17px] font-semibold text-ink">{info.fullName}</h2>
                  <p className="mt-0.5 text-[13px] leading-snug text-ink-faint">{HOW[provider]}</p>
                </div>
                {connection && (
                  <span className="badge flex-none bg-ok-soft text-ok">
                    <span aria-hidden className="dot bg-ok" />
                    Connected
                  </span>
                )}
              </div>

              <ul className="flex flex-col gap-1.5 text-[13px]">
                <Feature yes>Classes, due dates and exams</Feature>
                <Feature yes={info.capabilities.directions}>Assignment directions</Feature>
                <Feature yes={info.capabilities.submissionStatus}>What you&apos;ve turned in</Feature>
                <Feature yes={info.capabilities.materials}>Course files, for notes and the class assistant</Feature>
              </ul>

              <div className="mt-auto flex items-center justify-between gap-3 border-t border-border-soft pt-3 text-[13px]">
                <span className="text-ink-faint">
                  {connection
                    ? connection.lastSyncedAt
                      ? `Synced ${formatPastMoment(connection.lastSyncedAt, new Date(), user.timezone)}`
                      : "Not synced yet"
                    : `Use ${info.name}?`}
                </span>
                <span className="inline-flex items-center gap-1 font-medium text-accent-ink">
                  {connection ? "Open" : "Connect"}
                  <ArrowRightIcon className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </span>
              </div>
            </Link>
          );
        })}
      </div>

      <p className="mt-6 max-w-2xl text-xs leading-relaxed text-ink-faint">
        Brightspace and Blackboard only let apps a school&apos;s IT department has approved read courses, so Campus OS
        connects to them through your calendar: classes, due dates and exams come in, and you check work off here as you
        finish it. Not sure which one your school uses? It&apos;s the site where your professors post assignments.
      </p>
    </AppShell>
  );
}
