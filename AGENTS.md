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
- tabs/offscreen.ts produces tabs/offscreen.html and owns Trystero through lib/room.ts. background.ts restores saved sessions on startup/install and uses a one-minute alarm to recover a lost offscreen document. Popup closure and worker suspension do not own the transport lifetime.
- Trystero is pinned to 0.26.0, using default public Nostr signaling and STUN. No TURN fallback is configured: restricted networks may fail. Never embed private TURN credentials; a future managed TURN integration needs a credential service. yarn.lock is the dependency lockfile; use yarn install for dependency resolution.
- lib/room-protocol.ts defines wtg2 invitations containing room ID, secret and creator public key. Old wtg1 invitations are intentionally incompatible. Treat the whole invitation as an access secret.
- lib/identity.ts uses persistent ECDSA P-256 keys. Nonce proofs bind room ID and both transport IDs; accept each challenge only once within its expiry. Verify the admin public key from the invitation, not a claimed sender/admin flag. lib/room.ts binds authenticated keys to live Peer IDs, serializes async state changes, and limits/deduplicates messages.
- lib/persistence.ts validates version-1 local vaults: identity, active session and signed termination certificates. Absent storage initializes a vault; unknown schemas or corrupt keys stop recovery without replacing identity. Future schema changes require explicit migration. All storage goes through background; offscreen uses runtime messages only. Only the exact offscreen URL may read/write the vault; local storage access is restricted to trusted extension contexts.
- Leaving clears the active saved session, preserving keys. Ending requires the creator's key and persists a signed certificate before transmission. Archived rooms keep lightweight Trystero responders that relay certificates to returning peers, also after restart. Offline users learn termination only when a certificate holder is online; no server provides durable delivery.
- Guest recovery hides saved room details until an authenticated admin snapshot arrives. Missing admin means waiting, never host election. Reconnect rebuilds back off from 30s to 5min; failed transport creation is retried by the recovery alarm. Restored playback state starts paused; future common playback commands must require current admin readiness.
- components/room-panel.tsx polls the offscreen state, supports copy/paste invitations and captures the selected video's initial state on room creation. Snapshots do not yet navigate tabs, bind a remote player or synchronize playback; those belong to later stages.
- RoomView.ready gates room details: the creator has authoritative local state immediately; guests become ready only after a validated admin snapshot, and retry resets readiness. Do not use peer discovery or participant count as a readiness signal. components/loading-status.tsx provides the shared loading indicator; errors/retry/leave remain accessible while joining.
- contents/video.ts owns per-frame video discovery, selection and rebinding. Discovery traverses open shadow roots; snapshots refresh while popup is open (2s polling). DOM replacement is resolved lazily on snapshots; future playback commands must resolve the binding before use.
- lib/bindings.ts stores up to 50 local page bindings separately from room state. Save position at most every 2s during playback and on pause/seek/rate changes. Resolve current frame topology by URL after reload, never persist tabId/frameId; duplicate page tabs or frame candidates require manual selection. Content retries restore for up to a minute, pauses the player and restores finite-media position when metadata is ready. Blob-source changes, live media and unavailable players may require manual selection.
- lib/video-dom.ts builds unique selectors within each Document/ShadowRoot and verifies source/duration during resolution. lib/video.ts defines descriptors and snapshots. Frame paths currently contain ancestor-frame URLs, with tabId/frameId used for live routing; repeated identical frame URLs require explicit selection rather than assuming identity across users.
- components/video-picker.tsx displays videos across accessible frames, metadata/posters and selection controls. Selecting in one frame clears other frame selections; Escape cancels picking across the tab. Closed shadow roots cannot be inspected or reliably detected and must not be presented as supported.
- lib/messages.ts defines validated local messages and typed replies. Every DOM route uses explicit tabId and frameId. Content scripts may route only to their own frame.
- Transport, room state and future sync modules go under lib/ and are owned by offscreen; DOM logic stays in content scripts. Offscreen uses chrome.runtime only; tab operations go through background.
- Permissions: offscreen, activeTab, webNavigation (frame topology), storage, alarms and HTTP(S) host access. No scripting/tabs permission is needed. Chrome internal pages, Web Store and inaccessible frames are unsupported. Refresh existing tabs after extension reload to attach content scripts.

## Verification

- npm run typecheck
- npm test (real WebCrypto identity/proof checks, simulated transport recovery/termination, protocol validation and mocked Chrome binding recovery; not a real-browser/network test)
- npm run build
- npm run dev produces build/chrome-mv3-dev; production output: build/chrome-mv3-prod.
- In real Chrome: load unpacked build, refresh an HTTP(S) page, open popup, run diagnostics. Close/reopen popup and verify the same instance ID/start time. Stop the service worker and verify diagnostics still reports the same offscreen instance. Production worker lifecycle must be checked separately from dev (Plasmo dev keeps worker active).
- Restricted pages should report errors; offscreen is created on demand. Do not claim browser verification from successful compilation alone.
