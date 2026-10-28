import { chatgptUrl } from "@/lib/flashcards";
import { ChatIcon, CheckIcon, ExternalIcon } from "@/components/icons";
import { CardHeader } from "@/components/ui/CardHeader";
import type { ChatGptStudyInfo } from "./study-types";

/**
 * "Study with ChatGPT": once Campus OS is connected in ChatGPT (the plugin,
 * src/app/mcp), each button opens ChatGPT with a request typed in, and
 * ChatGPT reads this class from Campus OS itself. Before that, one button to
 * connect it, and nothing at all until the plugin is published
 * (CHATGPT_PLUGIN_URL), so students never see a feature they can't use yet.
 */
export function ChatGptStudyCard({ info }: { info: ChatGptStudyInfo }) {
  if (!info.connected && !info.connectUrl) return null;
  return (
    <section className="card card-pad">
      <CardHeader
        icon={<ChatIcon className="h-[18px] w-[18px]" />}
        title="Study with ChatGPT"
        description={
          info.connected
            ? "ChatGPT reads this class's notes and course files from Campus OS. Pick one to start."
            : "Connect Campus OS to ChatGPT once, and ChatGPT can quiz you and explain your lectures from your real notes."
        }
      />

      {info.connected ? (
        <>
          <span className="badge mt-4 bg-ok-soft text-ok">
            <CheckIcon className="h-3.5 w-3.5" />
            Connected to ChatGPT
          </span>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {info.prompts.map((p) => (
              <a
                key={p.label}
                href={chatgptUrl(p.prompt)}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary justify-between sm:justify-center"
              >
                <span className="truncate">{p.label}</span>
                <ExternalIcon className="h-3.5 w-3.5 flex-none text-ink-faint" />
              </a>
            ))}
          </div>
          <p className="mt-3 text-xs text-ink-faint">Opens ChatGPT with your request typed in. It can read your Campus OS account but can&apos;t change it.</p>
        </>
      ) : info.connectUrl ? (
        <>
          <ol className="mt-4 flex flex-col gap-2 text-sm text-ink-soft">
            <li className="flex gap-2.5">
              <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-surface-2 text-[11px] font-semibold">1</span>
              In ChatGPT, tap <strong className="font-medium text-ink">Connect</strong> on Campus OS.
            </li>
            <li className="flex gap-2.5">
              <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-surface-2 text-[11px] font-semibold">2</span>
              Log in to Campus OS if it asks, and tap <strong className="font-medium text-ink">Allow</strong>.
            </li>
          </ol>
          <a href={info.connectUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary mt-4">
            Connect in ChatGPT
            <ExternalIcon className="h-3.5 w-3.5" />
          </a>
          <p className="mt-3 text-xs text-ink-faint">Come back here afterwards and the study buttons appear. Disconnect any time in Account.</p>
        </>
      ) : null}
    </section>
  );
}
