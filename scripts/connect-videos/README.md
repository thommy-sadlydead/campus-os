# Connect videos

The short how-to videos on the Connect pages (`public/videos/connect-*.mp4`,
shown by `src/components/connect/ConnectVideo.tsx`). All four use one
template (`cw.js`) and differ only in each LMS's steps:

- The LMS scenes are simplified drawings of the screens in that LMS's own
  help guide: button names, menus and dialog text match the guide, and
  secrets are drawn blurred. Check a guide again before changing a scene.
  - Canvas: Instructure's "How do I manage API access tokens in my user
    account?" (since Oct 2026 students must set an expiration date, at most
    30 days out).
  - Schoology: Schoology's own SDK readme (`/api`, **Request API Keys**,
    Consumer Key and Secret). No official screenshot of that page was
    found, so it's drawn plainly.
  - Brightspace: D2L's "Manage course events with the Calendar tool"
    (Settings → **Enable Calendar Feeds**), with school guides for the
    Subscribe dialog.
  - Blackboard (Ultra): school guides for Calendar → Calendar Settings →
    **•••** → **Share Calendar**.
- The last scene films the real Connect page, so make the videos again
  whenever a Connect form or these steps change.

## Making them

1. Start the dev server on port 3100 against a **local** database (never
   production), with the seed data in it (`npm run db:seed`).
2. `node scripts/connect-videos/login.mjs` (logs headless Chrome in as the
   seed account).
3. `node scripts/connect-videos/render.mjs canvas` (or `schoology`,
   `brightspace`, `blackboard`). Add `--preview` for a few stills per scene.

Needs Google Chrome (`CHROME_PATH` to point elsewhere) and ffmpeg.
