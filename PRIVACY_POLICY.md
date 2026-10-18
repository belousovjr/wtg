# Watchly Privacy Policy

**Effective date: October 19, 2026**

Watchly is a browser extension developed by **belousovjr**. It lets participants in an invited room watch videos on their own devices with synchronized player selection and playback controls.

Contact: **belousowork@gmail.com**

## 1. Overview

Watchly does not operate a developer-hosted account or analytics backend. However, it does process information locally and exchange information with room participants and third-party connection services to provide synchronized viewing. “Peer-to-peer” does not mean that no information is processed or that connections are anonymous.

Watchly synchronizes existing website players. It does not record, upload, stream, or redistribute the video or audio being watched. Each participant accesses content directly from its original website.

## 2. Information Watchly processes

### Nicknames and participant identifiers

Watchly processes the nickname you enter, public cryptographic identity keys, temporary connection identifiers, room membership information, and player readiness. Your nickname and public identity information are shared as needed with room participants. A nickname does not have to be your real name.

Watchly also creates and stores a private identity key on your device to authenticate your participation and preserve room administration rights. The private key is not sent to other participants. Room invitations contain access information, including a room identifier and secret. Treat an invitation as confidential and share it only with people you want to invite.

### Viewing pages and video-player information

Watchly processes page URLs and titles, embedded-frame URLs and frame relationships, player selectors, media-source URLs, video duration, and player state. It may display a video poster supplied by the website.

The selected page URL and player descriptor are shared with room participants to locate the corresponding video. URLs may include query parameters, fragments, or site-generated access tokens. Do not share a viewing page if its URL or player information contains information you do not want participants to receive.

Watchly uses website access to discover players, restore previously saved player bindings, identify the viewing tab, and provide synchronization. It does not build a general browsing-history database or collect unrelated page text for advertising or profiling. It does not request your website passwords or read website cookies to log you in.

### Playback actions

Watchly processes and exchanges playback position, play and pause actions, seeking, playback speed, synchronization timing, and loading or permission-related status. It handles pointer and keyboard events while player selection is active, for example to highlight a player, select it, or cancel selection. It does not record general keyboard input or maintain a general-purpose click or mouse-movement history.

### Local settings and recovery records

Watchly stores your nickname, language preference, identity keys, active room invitation and state, signed room membership and termination records, removed-participant names, and saved player bindings and playback positions. Temporary session storage tracks the viewing tab and pending player selections.

### Connection information

Watchly uses WebRTC and the bundled Trystero library. Public Nostr signaling relays and STUN services help participants establish connections. These services process connection-establishment information and can receive your IP address and connection metadata. Room peers may also learn network-address information through WebRTC. Watchly does not use these addresses to determine your physical location and does not request GPS access.

## 3. How information is used

Information is used to:

- Create, join, authenticate, and maintain watch rooms.
- Locate the selected page and video player on each participant's device.
- Synchronize playback actions and show connection and readiness status.
- Restore settings, player bindings, and saved sessions after reloads or browser restarts.
- Enforce participant admission, removal, and room termination.

Watchly does not use this information for advertising, behavioral profiling, creditworthiness assessments, or lending decisions. The extension does not include advertising or analytics SDKs.

## 4. Who receives information

**Room participants:** Information needed for shared viewing is sent to participants in your room. The creator coordinates room state and playback ordering and can manage admission. Participants are independent recipients; Watchly cannot prevent someone from retaining information already received, copying an invitation, or sharing it outside the extension.

**Connection-service providers:** Third-party signaling relays and STUN services handle the information needed to establish connections. Their own practices determine what connection metadata or logs they retain. The developer does not control these independently operated services.

**Video and image providers:** Your browser continues to communicate with the websites that provide the video. Displaying a poster may also request an image from its original host. Those providers process requests under their own privacy policies. Access to subscription or restricted content remains subject to each participant's own authorization.

**Developer support:** If you email the developer, the developer receives your email address, message, and any information or attachments you choose to provide. This information is used to respond to and address your request. Do not send private identity keys, room invitations, or sensitive media URLs unless you intentionally want to disclose them.

The developer does not sell user data or provide it to advertising or data-broker services.

## 5. Storage, retention, and your choices

Extension settings and recovery information are stored in Chrome extension storage on your device. Local data is not deliberately synchronized to a developer account. Chrome session storage is used for temporary viewing-tab and selection state. Saved player bindings are limited to the most recent 50 entries; other recovery and membership records can remain until the extension's local storage is cleared or the extension is uninstalled.

Closing the popup does not disconnect an active room. Use **Leave room** as a participant or **End room for everyone** as the creator to stop participating in that room. Previously stored identity, settings, player bindings, and security records are not all deleted by leaving or ending a room. Stored termination records may be used to notify participants that a room has ended.

You can change your nickname before joining or creating a room and change the interface language in the popup. You can revoke website access or disable Watchly in Chrome's extension settings. Removing the extension from a Chrome profile removes its local extension storage from that profile. Copies in backups or other browser profiles, information already received by other participants, and logs held by independent service providers are not deleted by uninstalling Watchly.

Support correspondence is retained only for as long as reasonably needed to handle the request and any applicable legal obligations. Contact the developer about support data or other privacy questions. The developer cannot remotely inspect or delete extension data stored only on your device, or delete information held independently by room participants or service providers.

## 6. Security

Watchly uses cryptographic identity proofs and signed membership records for room authentication and administration. WebRTC data channels use encrypted transport. Private identity keys remain in local extension storage, not in room messages. Local storage is not an independently password-protected vault, so access to your browser profile or device can expose locally stored information.

No software or network connection can guarantee absolute security. Keep your browser and extension up to date, protect your device, and only share invitations with people you trust.

## 7. Chrome Web Store Limited Use

Watchly's use and transfer of information received through Chrome extension APIs adheres to the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), including its Limited Use requirements. Information is used and shared only as needed for the disclosed watch-together functionality and related security and support, not for unrelated advertising, creditworthiness, or lending purposes.

## 8. Changes to this policy

This policy may be updated to reflect changes to Watchly or its data practices. The current policy will be available at the privacy-policy URL linked from the Chrome Web Store listing, with an updated effective date. Additional disclosures or consent will be provided where required before introducing materially different data handling.

## 9. Contact

For privacy questions or requests, contact **belousovjr** at **belousowork@gmail.com**.
