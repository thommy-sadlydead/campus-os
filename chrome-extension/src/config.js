// Where Campus OS lives. The extension only pairs with, and only sends
// course data to, these origins: the address the iPhone and Mac apps use
// (first, so an unpaired popup's "Open Campus OS" goes there) and the
// custom domain. scripts/build-extension.mjs writes a development copy
// that adds this computer's local server.
export const API_ORIGINS = ["https://campus-os-mocha-pi.vercel.app", "https://app.campus-os.net"];

/** How long after a sync the extension waits before syncing again on its own. */
export const AUTO_SYNC_HOURS = 6;
