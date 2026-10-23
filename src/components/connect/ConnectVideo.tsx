/**
 * The short how-to video on a Connect page (public/videos/connect-<lms>.mp4).
 * Each one walks through the steps from that LMS's own help guide and ends on
 * the real Connect page; scripts/connect-videos makes them again when the
 * steps or the page change. No sound, and nothing downloads until it's played.
 */
export function ConnectVideo({ lms, lmsName }: { lms: "canvas" | "schoology" | "brightspace" | "blackboard"; lmsName: string }) {
  return (
    <video
      controls
      playsInline
      muted
      preload="none"
      poster={`/videos/connect-${lms}.jpg`}
      aria-label={`How to connect ${lmsName}, step by step`}
      className="mx-auto mt-4 block aspect-[390/844] w-full max-w-[240px] rounded-2xl bg-surface-2 ring-1 ring-border-soft"
    >
      <source src={`/videos/connect-${lms}.mp4`} type="video/mp4" />
    </video>
  );
}
