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
- tabs/offscreen.ts produces tabs/offscreen.html and owns Trystero and in-memory room state through lib/room.ts. Browser shutdown, extension reload/update or context failure ends the session; persistent identity/rejoin after restart is not implemented. Popup closure and worker suspension do not own the transport lifetime.
- Trystero is pinned to 0.26.0, using default public Nostr signaling and STUN. No TURN fallback is configured: restricted networks may fail. Never embed private TURN credentials; a future managed TURN integration needs a credential service. yarn.lock is the dependency lockfile; use yarn install for dependency resolution.
- lib/room-protocol.ts defines versioned invitations, room commands and snapshot validation. Invitations contain random room ID/secret and the creator's current Peer ID; treat the entire invitation as an access secret. This is peer pinning for the prototype, not persistent cryptographic administrator identity (stage 4).
- lib/room.ts serializes local room mutations, owns join/leave/retry and periodic hello/snapshot recovery. Only snapshots from the invitation's admin Peer ID are accepted. Validate inbound state, deduplicate messages and limit size/rate; transport sender identity must come from Trystero, never a claimed sender field.
- components/room-panel.tsx polls the offscreen state, supports copy/paste invitations and captures the selected video's initial state on room creation. Snapshots do not yet navigate tabs, bind a remote player or synchronize playback; those belong to later stages.
- contents/video.ts owns per-frame video discovery, selection and rebinding. Discovery traverses open shadow roots; snapshots refresh while popup is open (2s polling). DOM replacement is resolved lazily on snapshots; future playback commands must resolve the binding before use.
- lib/video-dom.ts builds unique selectors within each Document/ShadowRoot and verifies source/duration during resolution. lib/video.ts defines descriptors and snapshots. Frame paths currently contain ancestor-frame URLs, with tabId/frameId used for live routing; repeated identical frame URLs require explicit selection rather than assuming identity across users.
- components/video-picker.tsx displays videos across accessible frames, metadata/posters and selection controls. Selecting in one frame clears other frame selections; Escape cancels picking across the tab. Closed shadow roots cannot be inspected or reliably detected and must not be presented as supported.
- lib/messages.ts defines validated local messages and typed replies. Every DOM route uses explicit tabId and frameId. Content scripts may route only to their own frame.
- Transport, room state and future sync modules go under lib/ and are owned by offscreen; DOM logic stays in content scripts. Offscreen uses chrome.runtime only; tab operations go through background.
- Permissions: offscreen, activeTab, webNavigation (enumeration of frame IDs/parents) and HTTP(S) host access. No scripting/tabs/storage permission is needed yet. Chrome internal pages, Web Store and inaccessible frames are unsupported. Refresh existing tabs after extension reload to attach content scripts.

## Verification

- npm run typecheck
- npm test (protocol validation and room lifecycle with mocked transport; not a real-network test)
- npm run build
- npm run dev produces build/chrome-mv3-dev; production output: build/chrome-mv3-prod.
- In real Chrome: load unpacked build, refresh an HTTP(S) page, open popup, run diagnostics. Close/reopen popup and verify the same instance ID/start time. Stop the service worker and verify diagnostics still reports the same offscreen instance. Production worker lifecycle must be checked separately from dev (Plasmo dev keeps worker active).
- Restricted pages should report errors; offscreen is created on demand. Do not claim browser verification from successful compilation alone.
