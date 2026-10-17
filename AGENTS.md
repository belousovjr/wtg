# Working instructions

- Follow IMPLEMENTATION_PLAN.md sequentially and mark items complete only after verification. Keep progress and one-off verification results in that plan.
- Update this file only with useful lasting project context: product rules, architecture, module responsibilities, constraints, and development commands. Do not add entries merely to record completion. Replace outdated guidance; avoid logs, diagnostic values, conversation history, and duplicated plan checklists.
- Preserve user changes; use apply_patch for edits.

## Product

- Watch Together synchronizes local HTML video players between users through Trystero rooms; media itself is not streamed between participants.
- The creator remains administrator and alone can remove participants. All participants can choose the shared URL/video, control playback, and share invitations.
- The creator coordinates command ordering and shared time without extra playback privileges. Prioritize synchronized playback; do not promise nanosecond precision in browsers.

## Architecture

- Chrome MV3, Plasmo 0.90.5, React 18, TypeScript. Chrome 116+ is required for runtime.getContexts.
- popup.tsx is disposable UI and diagnostics; never own room connections there.
- background.ts routes messages and lazily creates the WEB_RTC offscreen document. Concurrent creation is serialized; worker restart discovers the existing context.
- tabs/offscreen.ts produces tabs/offscreen.html and will own Trystero, room state and synchronization. Trystero itself belongs to stage 3. Browser shutdown, extension reload/update or context failure ends in-memory state; persistence/rejoin is not implemented.
- contents/video.ts runs in permitted HTTP(S) frames. Currently only frame diagnostics; discovery and video control belong to stage 2 and later.
- lib/messages.ts defines validated local messages and typed replies. Every DOM route uses explicit tabId and frameId. Content scripts may route only to their own frame.
- Future transport, room state and sync modules go under lib/ and are owned by offscreen; DOM logic stays in content scripts. Offscreen uses chrome.runtime only; tab operations go through background.
- Permissions: offscreen, activeTab and HTTP(S) host access. No scripting/tabs/storage permission is needed yet. Chrome internal pages, Web Store and inaccessible frames are unsupported.

## Verification

- npm run typecheck
- npm run build
- npm run dev produces build/chrome-mv3-dev; production output: build/chrome-mv3-prod.
- In real Chrome: load unpacked build, refresh an HTTP(S) page, open popup, run diagnostics. Close/reopen popup and verify the same instance ID/start time. Stop the service worker and verify diagnostics still reports the same offscreen instance. Production worker lifecycle must be checked separately from dev (Plasmo dev keeps worker active).
- Restricted pages should report errors; offscreen is created on demand. Do not claim browser verification from successful compilation alone.
