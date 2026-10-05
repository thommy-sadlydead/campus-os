import { CheckCircleIcon } from "@/components/icons";

/**
 * For students on an LMS that doesn't say what they've turned in
 * (Brightspace, Blackboard): their work stays open here until they check
 * it off.
 */
export function CheckOffNote({ names }: { names: string }) {
  const several = names.includes(" and ");
  return (
    <p className="mb-6 flex items-start gap-2.5 rounded-xl2 bg-surface-2 px-4 py-3 text-[13px] leading-relaxed text-ink-soft">
      <CheckCircleIcon className="mt-0.5 h-4 w-4 flex-none text-ink-faint" />
      <span>
        {names} {several ? "don't" : "doesn't"} share what you&apos;ve turned in, so check work off here when you finish
        it.
      </span>
    </p>
  );
}
