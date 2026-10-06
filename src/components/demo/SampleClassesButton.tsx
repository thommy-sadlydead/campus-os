"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addSampleClassesAction } from "@/app/dashboard/actions";

/** For the App Store review account only (the page checks before showing it, and the action checks again). */
export function SampleClassesButton({ label }: { label: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await addSampleClassesAction();
            if (result.error) setError(result.error);
            else router.refresh();
          })
        }
        className="btn btn-secondary"
      >
        {pending ? "Adding…" : label}
      </button>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
