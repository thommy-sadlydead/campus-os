import { calendarFeedFor } from "@/lib/calendar-feed-server";
import { getAccess, paymentsEnabled } from "@/lib/billing-server";

// A student's class meetings for their calendar app to subscribe to
// (Schedule → Add to your calendar). The secret link is the only key.
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const feed = await calendarFeedFor(token.replace(/\.ics$/i, ""));
  if (!feed) return new Response("Not found", { status: 404 });
  if (paymentsEnabled() && (await getAccess(feed.userId)).kind === "none") {
    return new Response("This Campus OS account's free trial or subscription has ended.", { status: 403 });
  }
  return new Response(feed.ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="campus-os-classes.ics"',
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
