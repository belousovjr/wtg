# Chrome Web Store privacy fields

Copy-ready English text for the current production implementation. Recheck when permissions, networking or data handling change. These notes are not a published privacy policy or a guarantee of Store approval.

## Single purpose

Watchly lets participants in an invited room watch online videos together by synchronizing the selected page, video player, playback position, play/pause actions and playback speed. Each participant accesses the video on its original website; Watchly does not stream or redistribute the video itself.

## Permission justification: offscreen

Watchly uses a packaged offscreen document to maintain WebRTC room connections and coordinate synchronized playback independently of the popup. Manifest V3 service workers cannot host the DOM-based WebRTC functionality used by the bundled room library. Closing the popup must not disconnect participants or interrupt the watch session.

## Permission justification: alarms

Watchly uses a periodic recovery alarm to check a saved watch session, recreate a missing offscreen connection and retry binding the shared player in the viewing tab. Alarms allow this recovery after the Manifest V3 service worker has been suspended. They are used for session recovery, not advertising or analytics.

## Permission justification: storage

Watchly stores the user's nickname and interface language, cryptographic identity keys, room invitations and saved session state, signed membership/room-termination records, removed-participant names, and local player bindings and playback positions. Session storage tracks the viewing tab and pending player selection. This supports session recovery, persistent room administration and restoring the selected player after a page reload. This data is not used for advertising or analytics.

## Permission justification: webNavigation

Watchly uses webNavigation.getAllFrames to locate video players embedded in nested frames and route player selection and synchronization messages to the correct frame. Navigation completion events trigger checks for the selected player after the viewing page loads or reloads. Frame URLs and ancestry are used to identify the shared player across participants; they are not collected for advertising or a general browsing-history database.

## Host permissions: http://*/* and https://*/*

Watchly supports user-selected HTML video players on arbitrary HTTP and HTTPS websites, including players embedded in cross-origin frames. Access is needed to discover and highlight video elements, apply the shared player selection, read playback state, synchronize play/pause/seeking/speed, show status indicators and restore the binding after navigation or reload. The extension also reads tab URLs and titles to identify the selected viewing page and display its title. Broad host access is necessary because the supported viewing page and embedded-player domains are chosen by users rather than a fixed site list. Content scripts run on matching pages; room playback actions are restricted to the designated viewing tab and frame. Watchly does not scrape unrelated page text or use browsing data for advertising or analytics.

## activeTab

Removed as redundant with HTTP(S) host permissions. Upload a newly built production ZIP before filling out the final permission list. Do not invent a justification for a permission absent from the updated manifest.

## Remote code

Select **No, I am not using remote code** for the current production implementation.

If a text explanation is requested:

All executable JavaScript and extension UI code, including third-party libraries, are bundled inside the extension package. Watchly does not download or execute remote JavaScript or WebAssembly. Network connections to public signaling relays, STUN services and room peers exchange connection-establishment data and validated room/playback messages, not executable code. Video content remains on the original website. The production package does not include the development hot-reload client.

Never submit the development build. A remote-code question is not a request to justify a WebSocket connection: remote data transport and remote executable code are different things.

## Data practices: do not claim zero data transfer

- Invited participants receive the selected page URL, video descriptor (including frame/media URLs, selector and duration), nickname, public identity/membership information, playback commands and readiness information. URLs can contain query parameters or fragments; describe this accurately in the privacy policy.
- Persistent private identity keys stay in local extension storage; peers receive public keys and authentication proofs, not private keys.
- Public signaling and STUN infrastructure process connection-establishment information. Peer-to-peer networking can reveal network/IP information to service providers and peers. P2P does not mean anonymous or serverless signaling.
- Local storage retains settings, identity, room records and player bindings. State is not an advertising or analytics dataset. Uninstalling the extension removes its local Chrome extension storage; data already shared with peers or retained by external infrastructure is not thereby deleted.
- The author email in package metadata is a support contact, not a user login requirement. The extension does not ask participants for their email addresses.
- Disclose data handling consistently in the Store checkboxes and a publicly accessible privacy policy. Review the Store's actual category definitions before choosing the checkboxes; do not select “no data collected” merely because the developer operates no backend.
- Certify Limited Use only after reviewing that the implementation, published policy and declarations match. This file does not submit or certify anything on the publisher's behalf.

## Publisher actions

1. In Developer Dashboard settings, enter the publisher contact email (use belousowork@gmail.com if that is the intended monitored support address).
2. Complete the verification email flow. The package author field does not verify or configure the publisher account.
3. Publish an accurate privacy policy and add its public URL to the listing.
4. Fill in the single-purpose and permission fields, select the correct remote-code answer, disclose data handling and personally confirm the required policy declarations.
5. Run npm run build, then npm run package, and upload build/chrome-mv3-prod.zip. Inspect the resulting manifest: permissions should be offscreen, webNavigation, storage and alarms, plus the HTTP(S) host grants.

## Official references

- https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- https://developer.chrome.com/docs/extensions/reference/api/tabs
- https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code
