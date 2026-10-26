import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AuthCard } from "@/components/ui/AuthCard";
import { CheckIcon } from "@/components/icons";
import { resolveAuthorizeRequest } from "./request";
import { approveAuthorizationAction, denyAuthorizationAction, switchAccountAction } from "./actions";

export const metadata: Metadata = { title: "Connect an app · Campus OS" };

// What the student is shown before ChatGPT can read their account. Keep
// this list in step with the MCP tools (src/lib/mcp/tools-server.ts) and
// the privacy policy's ChatGPT section.
const CAN_SEE = [
  "Your name and email address, to label the connection",
  "Your classes, meeting times and current grades",
  "Assignments, due dates, steps and exams",
  "Your notes and lecture notes",
  "Text from your course files",
];

export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") query.set(key, value);
  }

  const req = await resolveAuthorizeRequest(query);
  if (req.kind === "redirect") redirect(req.url);
  if (req.kind === "fatal") {
    return (
      <AuthCard title="Can't connect" footer={null}>
        <p className="mt-4 text-center text-sm leading-relaxed text-ink-soft">{req.message}</p>
      </AuthCard>
    );
  }

  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${query}`)}`);

  const appName = req.client.clientName;
  const queryString = query.toString();
  return (
    <AuthCard title={`Connect ${appName}`} description={`${appName} is asking to read your Campus OS account.`} footer={null}>
      <div className="flex items-center justify-between gap-3 rounded-xl2 bg-surface-2 px-3.5 py-2.5 text-sm">
        <span className="min-w-0 truncate text-ink-soft">
          Signed in as <span className="font-medium text-ink">{user.email}</span>
        </span>
        <form action={switchAccountAction} className="flex-none">
          <input type="hidden" name="query" value={queryString} />
          <button className="text-xs font-medium text-ink-soft underline underline-offset-2 hover:text-ink">Not you?</button>
        </form>
      </div>

      <p className="mt-5 text-sm font-medium text-ink">{appName} will be able to see:</p>
      <ul className="mt-2.5 flex flex-col gap-2 text-sm text-ink-soft">
        {CAN_SEE.map((item) => (
          <li key={item} className="flex items-start gap-2">
            <CheckIcon className="mt-0.5 h-4 w-4 flex-none text-ok" />
            {item}
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs leading-relaxed text-ink-faint">
        It can&apos;t change anything in Campus OS, and it never sees your password, your Canvas or other school
        connections, or your Gmail. What it reads goes to {appName} (OpenAI) and is handled under their privacy policy.
        You can disconnect any time under Account → Connected apps.{" "}
        <Link href="/privacy" className="underline underline-offset-2 hover:text-ink">
          Privacy policy
        </Link>
      </p>

      <div className="mt-6 flex flex-col gap-2">
        <form action={approveAuthorizationAction}>
          <input type="hidden" name="query" value={queryString} />
          <button className="btn btn-primary btn-lg w-full">Allow</button>
        </form>
        <form action={denyAuthorizationAction}>
          <input type="hidden" name="query" value={queryString} />
          <button className="btn btn-secondary w-full">Cancel</button>
        </form>
      </div>
    </AuthCard>
  );
}
