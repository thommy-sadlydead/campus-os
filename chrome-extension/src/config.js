// Where Campus OS lives. The extension only pairs with, and only sends
// course data to, these origins. scripts/build-extension.mjs writes a
// development copy that adds this computer's local server.
export const API_ORIGINS = ["https://app.campus-os.net"];

/** How long after a sync the extension waits before syncing again on its own. */
export const AUTO_SYNC_HOURS = 6;
