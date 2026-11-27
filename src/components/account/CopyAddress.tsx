"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "@/components/icons";
import { copyToClipboard } from "@/lib/clipboard";

/** An address to paste somewhere else (Account → ChatGPT and Claude), with a Copy button. */
export function CopyAddress({ label, address }: { label: string; address: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (await copyToClipboard({ text: address })) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div>
      <p className="eyebrow">{label}</p>
      {/* The button drops below the address on phones, where the two don't fit side by side. */}
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <input
          readOnly
          value={address}
          aria-label={label}
          onFocus={(e) => e.currentTarget.select()}
          className="field min-w-[min(17rem,100%)] flex-1 font-mono text-[13px]"
        />
        <button type="button" onClick={copy} className="btn btn-secondary flex-none">
          {copied ? <CheckIcon className="h-4 w-4 text-ok" /> : <CopyIcon className="h-4 w-4" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
