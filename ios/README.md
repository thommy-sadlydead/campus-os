# Campus OS for iPhone, iPad and Mac

The app is a [Capacitor](https://capacitorjs.com) shell around the live site
(`server.url` in `../capacitor.config.json`), plus native features the site
uses when it runs inside the app:

| Feature | Native code | Website side |
| --- | --- | --- |
| Share a recording from Voice Memos or Files into Campus OS | `App/ShareExtension/ShareViewController.swift` (share extension), `App/App/SharedInbox.swift` (inbox both targets share through the App Group) | `src/components/lectures/NativeInbox.tsx` on /record, `src/components/NativeAppBridge.tsx` (banner, opens /record after a share) |
| Recording that keeps going with the screen locked | `App/App/NativeRecorderPlugin.swift` (AVAudioRecorder, `UIBackgroundModes: audio`) | `src/components/lectures/LectureRecorder.tsx` |
| Connect Gmail (Google blocks sign-in inside web views) | `App/App/AuthSessionPlugin.swift` (ASWebAuthenticationSession) | `src/components/email/ConnectGmailButton.tsx`, `src/lib/native-oauth.ts` |
| Due-date reminders | `@capacitor/local-notifications` | `src/components/dashboard/NativeReminders.tsx`, `src/lib/reminders.ts` |

The plugins in `App/App` are registered in `CampusBridgeViewController.swift`.
The website reaches them through `src/lib/native-app.ts` and does nothing
native when it runs in a browser. The app adds `CampusOSApp/1` to its user
agent, so server code can tell it apart (the dashboard uses that for
reminders).

## Build and run

Needs Xcode 26 or later with the iOS platform installed (Xcode → Settings →
Components), and `npm install` in the repo root. Swift packages resolve on
the first build; there's no CocoaPods.

```bash
npx cap sync ios
```

Run that after changing `capacitor.config.json` or adding a Capacitor
plugin. Then open `ios/App/App.xcodeproj`, pick a simulator, and Run. In the
Simulator, try the share extension from the Files app with an `.m4a` file
(Voice Memos isn't in the Simulator).

To test against a local server instead of the live site, temporarily set
`server.url` to `http://localhost:3000` in `capacitor.config.json`, add
`NSAppTransportSecurity` → `NSAllowsLocalNetworking = YES` to
`App/App/Info.plist`, and run `npx cap sync ios`. Undo both before releasing.

## Signing and release (needs the Apple Developer Program)

1. Both targets (**App** and **ShareExtension**) are signed with Reece's
   team (`DEVELOPMENT_TEAM = 96XYBAQGPL`) using automatic signing, which
   registers these IDs on the first signed build (`com.campusos.app` was
   already taken by another developer):
   - App: `com.reecebroderick.campusos`
   - Share extension: `com.reecebroderick.campusos.share`
   - App Group (both): `group.com.reecebroderick.campusos` (the `CAMPUS_APP_GROUP`
     build setting; change it there and in nothing else)

   The bundle IDs can be changed until the app is first uploaded; after
   that they're permanent. Automatic signing also needs at least one
   registered device: connect an iPhone once and build with
   `-allowProvisioningDeviceRegistration` (or run it from Xcode).
2. Bump `MARKETING_VERSION` (1.0, 1.1…) and `CURRENT_PROJECT_VERSION` (1, 2…)
   on **both** targets; they must match.
3. Product → Archive, then Distribute App → App Store Connect. The build
   shows up in TestFlight after processing.

Website changes reach the app immediately without a new build. A new build is
only needed for native changes (anything under `ios/` or a new Capacitor
plugin).

## App Store review notes

- **Demo account.** Sign-up is invite-only, so give reviewers a working
  login (with classes already synced) in App Review Information.
- **AI permission (guideline 5.1.2(i)).** The app asks before sending
  anything to Anthropic or AssemblyAI (`src/lib/ai-consent.ts`), and it can
  be turned off under Account → AI features.
- **Account deletion (5.1.1(v)).** Account → Delete account.
- **More than a website (4.2).** Point reviewers to the Voice Memos share,
  background recording and reminders.
- **Mac.** Leave "iPhone and iPad Apps on Apple Silicon Macs" on in App
  Store Connect to offer the iPad app on Macs.
