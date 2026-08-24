import { requireUser } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { StudioApp } from "@/components/voicewrite/StudioApp";

export default async function VoicewritePage() {
  const user = await requireUser();

  return (
    <AppShell active="/voicewrite" userName={user.name ?? user.email}>
      <div className="mx-auto mb-6 flex w-full max-w-3xl flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold">Voicewrite</h1>
        <p className="text-sm text-ink-soft">
          Generate natural, voice-matched writing from a prompt — optionally matched to a
          writing sample you save.
        </p>
        <p className="text-xs text-ink-faint">
          Saved writing styles live only in this browser&apos;s local storage, never on our
          servers. A style&apos;s sample text is sent to the AI provider only for the one request
          when you click Generate with it selected. Voicewrite is a writing-style
          personalization tool — it doesn&apos;t claim or guarantee that generated text will
          evade AI-detection tools.
        </p>
      </div>
      <StudioApp />
    </AppShell>
  );
}
