// Shared styling for rendered markdown (lecture notes, the class
// assistant's answers). No Tailwind typography plugin in this app, so
// markdown elements are styled via plain child-selector utilities instead
// of "prose", matching the rest of the app's no-plugin Tailwind use.
export const MARKDOWN_CLASSNAME =
  "text-sm leading-relaxed text-ink [&_h1]:mt-3 [&_h1]:font-display [&_h1]:text-base [&_h1]:font-semibold [&_h1]:first:mt-0 " +
  "[&_h2]:mt-3 [&_h2]:font-display [&_h2]:text-base [&_h2]:font-semibold [&_h2]:first:mt-0 " +
  "[&_h3]:mt-2 [&_h3]:text-sm [&_h3]:font-semibold " +
  "[&_p]:mt-2 [&_p]:first:mt-0 [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mt-2 [&_ol]:list-decimal [&_ol]:pl-5 " +
  "[&_li]:mt-1 [&_strong]:font-semibold [&_code]:rounded [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs " +
  "[&_table]:mt-3 [&_table]:w-full [&_table]:border-collapse [&_table]:text-xs " +
  "[&_th]:border [&_th]:border-border-soft [&_th]:bg-surface-2 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold " +
  "[&_td]:border [&_td]:border-border-soft [&_td]:px-2 [&_td]:py-1 [&_td]:align-top";
