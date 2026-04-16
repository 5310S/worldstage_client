# WorldStage Client

WorldStage Client is the desktop-side home agent for WorldStage.

This repo now has the first end-to-end background download path for the desktop client.

Current scaffold status:

- Electron app shell with tray/background behavior
- Electron Builder packaging targets for Linux, Windows, and macOS
- GitHub release publishing metadata for packaged desktop builds, with stable release asset names for Windows, macOS, Linux AppImage, and Linux `.deb`
- Background update checks against the GitHub release channel, plus install/restart controls in the desktop dashboard for packaged builds
- Persistent config and state stored under app data
- Optional launch-on-login support for Linux, Windows, and macOS so the home client can come up with the machine instead of requiring a manual app launch
- First-run dashboard checklist plus a one-click “home client defaults” action so non-technical users can turn on the recommended background behavior without manually understanding each setting
- WorldStage connection-link support in the packaged app and dashboard, including short-lived pairing-code claim against `5310s.com`, so setup can move through a website hand-off instead of exposing raw account tokens in the browser
- Local job queue for `download_and_seed` intents
- Real website bridge endpoints for device pairing, remote intents, remote commands, and device-status publishing
- Disk-backed per-job workspaces under the configured download directory
- Hidden transport host window that can claim prepared jobs and report lifecycle events
- WorldStage control-plane bootstrap for viewer peer announce, download record creation, and session offer creation when an account token is configured
- Background polling for control-plane session status so answered sessions surface in the desktop runtime
- WebRTC answer application and ICE candidate relay through the WorldStage session endpoints
- Manifest receipt, verified chunk persistence, artifact assembly, and local library registration
- Stable per-video seeder peer announcements for completed local copies
- Hidden transport-host answers for queued video download sessions using the local artifact and saved manifest
- Sandboxed in-app WorldStage site window for `siteOrigin/worldstage`, isolated from desktop IPC and opened separately because the site denies iframe embedding
- Periodic remote device-status publishing so the website can see queue, transfer, and seed-library state once the status bridge endpoint is available
- Remote command polling for website-issued `pause_seed`, `resume_seed`, `refresh_seed`, `remove_seed`, `cancel_job`, `retry_job`, and `remove_job` actions against the local queue and seed library
- Renderer UI for device config, queue inspection, and local paths
- Completed downloads are reset to viewer-only on the original downloader peer after a stable background seeder peer is announced for that local copy

Packaging targets:

- Linux: `AppImage`, `deb`
- Windows: `nsis`
- macOS: `dmg`

Install UX notes:

- Windows NSIS is configured for a one-click install with desktop/start-menu shortcuts and auto-launch after setup
- Linux packages expose desktop-entry metadata so the app behaves like a normal desktop application
- The dashboard can apply the recommended background defaults in one action: keep running on close, launch on login, and auto-start the background agent
- Packaged clients register the `worldstage://` protocol so `5310s.com` can hand a short-lived connection link directly into the installed app
- The app can also accept the HTTPS fallback pairing link through the manual `Connect With Link` flow if the browser or OS does not pass the custom protocol through automatically
- Packaged installs check `5310S/worldstage_client` GitHub releases for updates; tagged CI builds can publish those release artifacts directly from GitHub Actions
- Linux users should prefer the `AppImage` release when they want the easiest updater path; `.deb` remains available as a manual-install option

Build command:

- `npm run desktop:dist`
