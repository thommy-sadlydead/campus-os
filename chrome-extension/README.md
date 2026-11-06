# Campus OS Connector (Chrome extension)

Brings a student's **D2L Brightspace** and **Blackboard Learn** courses into
Campus OS (courses, assignments with directions and due dates, whether
they're turned in or graded, exams, and the course files and pages they can
open), using the sign-in already in their own browser. Canvas and Schoology
don't use it: students make their own API keys for those.

Neither LMS lets a student make an API key, and their APIs only open to apps
a school's IT department registers. The extension is how Campus OS reads
them without that. It reads only what the student's own account can already
see, only for the courses they choose, and never sees their password.

## How it works

1. **Pairing.** On Campus OS, Connect → Brightspace (or Blackboard) →
   "Connect the extension." The page asks the app for a one-time code (good
   for 10 minutes) and hands it to the extension's bridge script
   (`src/app-bridge.js`, which runs only on Campus OS's own pages). The
   service worker trades the code for a token (`/api/lms-extension/pair`).
   Campus OS stores codes and tokens only as HMACs
   (`src/lib/lms/extension-auth.ts`).
2. **Allowing the site.** On their school's Brightspace or Blackboard, the
   student clicks the Campus OS button. The popup recognizes the LMS from
   the address or the page, then asks Chrome for permission to read that one
   site (`chrome.permissions.request`). For Blackboard it also asks for
   `*.blackboardcdn.com`, where Blackboard's hosted sites hand out file
   downloads.
3. **Choosing courses.** The popup lists the student's courses from the LMS,
   all checked, and imports only the ones they leave checked. That's the
   consent step: nothing is read or sent before it.
4. **Syncing** (`src/sync.js`), in the service worker with the student's own
   session (`credentials: "include"`):
   - It checks the sign-in and lists the courses.
   - It reads each chosen course's assignments and quizzes, 3 courses at a
     time, and sends them to `/api/lms-extension/courses`. That endpoint
     uses the same `applyLmsCourses` as Canvas and Schoology.
   - It sends each course's file and page list to `/materials`, 2 courses at
     a time. The app replies with only what's new or changed (`planSync`),
     and records links and unreadable file types right away without a
     download.
   - It downloads those files 3 at a time and uploads them to `/upload`, in
     3.5 MB parts because Vercel caps requests at 4.5 MB. The app reads them
     with the same `readDocumentText` (PDF, PowerPoint, Word, EPUB, text,
     and OCR for scanned PDFs when AI is allowed) and `upsertMaterial`.
   - Files it can't get go to `/failed` with the reason, so the student sees
     why, and they're tried again next sync.
   - `/finish` marks the sync done from what the app actually saved. A
     course counts as done only when every file it asked for has been saved
     (`MaterialSyncState.resourcesPending`).
5. **Staying current.** After a site is allowed, a small content script
   (`src/lms-visit.js`) is registered for it alone. When the student opens
   that site, it tells the service worker, which syncs if it's been 6 hours.
   An hourly alarm does the same for a site that's open in a tab. "Sync
   now" is in the popup and on the Connect page.

Brightspace is read through D2L's Valence API (`/d2l/api/...`), with the
versions the site itself lists at `/d2l/api/versions/`. Blackboard is read
through the Learn REST API (`/learn/api/public/...`), newest endpoint version
first, falling back to older ones. Nothing is specific to one school.

## Permissions, and why (for the Chrome Web Store's privacy form)

| Permission | Why |
|---|---|
| `storage` | Keeps the token from pairing, the sites the student allowed and which courses they chose. |
| `activeTab` | When the student clicks the button, reads the address of the tab they're on to recognize Brightspace or Blackboard. |
| `scripting` | Checks the open page for Brightspace or Blackboard markers when the address doesn't say, and registers the visit script for allowed sites. |
| `alarms` | An hourly check that syncs an allowed site that's open and due. |
| Host: `https://campus-os-mocha-pi.vercel.app/*`, `https://app.campus-os.net/*` | Campus OS's two addresses (the one the iPhone and Mac apps use, and the custom domain). Sends the student's course data to their own Campus OS account, and runs the pairing bridge on Campus OS's pages. |
| Optional host: `https://*/*` | Asked for at run time, one school site at a time (plus `*.blackboardcdn.com` for Blackboard files), only when the student clicks "Allow access." Schools' LMS addresses aren't known in advance, so a fixed list isn't possible. |

The extension doesn't request `cookies`, `tabs`, `history`, `webRequest` or
`<all_urls>` up front. It never reads cookies or passwords, never bypasses a
sign-in, and only downloads what the student's account is allowed to
download. A file the LMS refuses (403) is recorded as refused, not worked
around.

## Building and publishing

```bash
node scripts/build-extension.mjs          # → chrome-extension/campus-os-connector-<version>.zip
node scripts/build-extension.mjs --dev    # → chrome-extension/dist-dev/ (load unpacked)
```

The dev build also trusts `localhost:3014` (Campus OS run locally) and the
stand-in LMS (`node scripts/lms-standin/server.mjs`, `localhost:4010` playing
Brightspace and `127.0.0.1:4010` playing Blackboard).

To publish:
1. Make a Chrome Web Store developer account (one-time $5 fee):
   https://chrome.google.com/webstore/devconsole
2. Build the ZIP and upload it as a new item.
3. Fill in the listing with the text below and the screenshots. On the
   privacy tab, enter the permission reasons from the table above, a single
   purpose, and the privacy policy URL: https://campus-os-mocha-pi.vercel.app/privacy.
   Under data use, it handles "website content" and "personally
   identifiable information" (the student's name and email from the LMS),
   only to provide the feature, never sold or transferred elsewhere.
4. Once it's approved, set `CHROME_EXTENSION_URL` in Vercel to its Web
   Store page, so the Connect pages show "Add to Chrome."
5. To publish an update, bump `version` in `manifest.json`, then build and
   upload again.

### Listing text

- **Name:** Campus OS Connector
- **Summary (132 characters max):** Bring your Brightspace and Blackboard
  courses, due dates and course files into Campus OS, using the sign-in you
  already have.
- **Description:** Campus OS Connector brings your D2L Brightspace or
  Blackboard Learn classes into Campus OS, your planner for classes,
  assignments and study. Open your school's site, click the Campus OS
  button, allow the site, and choose your courses. Your assignments and due
  dates, what you've turned in, and your lecture slides, PDFs, Word
  documents and course pages come into Campus OS, organized by class, ready
  for notes, flashcards and the class assistant. It reads only the courses
  you choose and only what your account can already open. It never sees
  your school password, and it can't change anything on your school's site.
  It keeps itself up to date when you open your school's site. Needs a
  Campus OS account.
- **Single purpose:** Imports the student's own Brightspace or Blackboard
  course information into their Campus OS account.
- **Category:** Education

## Limitations (what it can't do, honestly)

- **Not yet tried against a real school's site.** It's built from D2L's and
  Blackboard's published API references. It was tested with unit tests and,
  end to end in Chrome, against a local stand-in for both
  (`scripts/lms-standin/`). The first real school is the real test: watch
  for courses that don't list, assignments missing, or files that fail.
- **A school can turn things off.** If a course hides its gradebook, a tool
  is disabled, or the school blocks API access for students, that part is
  skipped and the reason shows in the popup and on the Connect page. Blackboard
  sites older than Learn 9.1 Q4 2017 (3000) have no REST API at all and get
  a clear "not supported."
- **Blackboard files on another server.** Hosted Blackboard sites redirect
  downloads to `*.blackboardcdn.com`, which the extension asks for. If a
  school sends them somewhere else, those files are recorded as failed,
  with the reason.
- **Brightspace quizzes** show as done only once graded: D2L has no
  one-request way to list a student's quiz attempts.
- **Ultra documents** whose content isn't in the REST API's `body` field come
  in as their attachments only.
- **Very big courses:** Blackboard content trees are read up to 1,500 items
  and 8 folders deep; a course past that says so, and files it didn't reach
  aren't marked deleted.
- **Desktop Chrome only** (and other Chromium browsers like Edge and Brave).
  Phones, Safari and the iPhone/iPad app use the calendar link instead.
