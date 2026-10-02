import { NextResponse } from "next/server";
import { AppleJwsError, verifyAppleJws, type AppleNotification } from "@/lib/apple-iap";
import { recordAppleTransaction } from "@/lib/subscriptions";

// App Store Server Notifications V2: Apple calls this when an iPhone-app
// subscription renews, fails to renew, is canceled or refunded. Set
// /api/apple/notifications as the Production and Sandbox Server URL under
// the app's App Information in App Store Connect.
export async function POST(request: Request) {
  let signedPayload: string | undefined;
  try {
    signedPayload = ((await request.json()) as { signedPayload?: string }).signedPayload;
  } catch {
    // handled below
  }
  if (!signedPayload) return NextResponse.json({ error: "Missing signedPayload." }, { status: 400 });

  try {
    const notification = verifyAppleJws<AppleNotification>(signedPayload);
    const transaction = notification.data?.signedTransactionInfo;
    if (transaction) {
      await recordAppleTransaction(transaction, { renewalJws: notification.data?.signedRenewalInfo });
    }
  } catch (err) {
    if (err instanceof AppleJwsError) {
      return NextResponse.json({ error: "Not a valid App Store notification." }, { status: 400 });
    }
    // Apple retries notifications that don't get a 2xx.
    console.error("App Store notification failed:", err);
    return NextResponse.json({ error: "Couldn't process the notification." }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
