This is a [Plasmo extension](https://docs.plasmo.com/) project bootstrapped with [`plasmo init`](https://www.npmjs.com/package/plasmo).

## Getting Started

### Rooms (prototype)

Rooms use Trystero 0.26.0 with public Nostr signaling. Select a video, create a
room, copy the invitation and paste it into the extension in another Chrome
profile or on another device. Each extension profile owns one room connection;
two tabs in the same profile are not two independent participants.

Keep the whole invitation private: it contains the access secret. The popup may
be closed without leaving the room. Use Leave to disconnect and disable automatic
rejoin, or Retry if the connection fails. The active session and persistent
ECDSA identity are stored locally: restarting Chrome or reloading the extension
rejoins the saved room. The creator remains admin even with a new transport ID.

Invitations now use `wtg2`; old `wtg1` invitations are incompatible. Create a new
room after upgrading from the previous prototype and share its new invitation.
Only the creator can End room. Closing Chrome is not an end command. Signed
termination notices persist and are relayed to returning participants while a
holder is online; offline delivery cannot be guaranteed without a server.

Refreshing a video page restores its saved binding and position on pause when
the player is accessible. Identical tabs/ambiguous frames require manual selection.
Storage schema/key errors stop recovery rather than silently replacing identity.

The room currently shares its initial source/player state and participant list.
Navigation and playback synchronization are not implemented yet. Public signaling
does not guarantee connectivity: no TURN relay fallback is configured in this
prototype. Test on different networks before relying on it.

Run `npm test` for protocol/lifecycle checks with a mocked transport. Actual
cross-device connectivity must be checked in Chrome separately.

### Diagnostics

Requires Chrome 116+. Run `npm run typecheck` and `npm run build` for verification.
Load `build/chrome-mv3-prod` as an unpacked extension at `chrome://extensions`
(Developer mode). For automatic rebuilding use `npm run dev` and load
`build/chrome-mv3-dev` instead.

Refresh an ordinary HTTP(S) tab after loading/reloading the extension. Open the
popup and click the diagnostics button. It checks the offscreen WebRTC context
and the active tab's top frame. Close and reopen the popup, then check again:
the context ID and start time should stay the same. Also verify with the service
worker stopped; dev mode alone is insufficient to verify worker suspension.

The offscreen document owns room connections and is recreated for saved sessions.
Chrome internal pages and the Web Store do not support content-script diagnostics.
Recovery may take up to a minute after unexpected offscreen termination.
Video selection and rooms are available; playback synchronization is a later stage.

First, run the development server:

```bash
pnpm dev
# or
npm run dev
```

Open your browser and load the appropriate development build. For example, if you are developing for the chrome browser, using manifest v3, use: `build/chrome-mv3-dev`.

You can start editing the popup by modifying `popup.tsx`. It should auto-update as you make changes. To add an options page, simply add a `options.tsx` file to the root of the project, with a react component default exported. Likewise to add a content page, add a `content.ts` file to the root of the project, importing some module and do some logic, then reload the extension on your browser.

For further guidance, [visit our Documentation](https://docs.plasmo.com/)

## Making production build

Run the following:

```bash
pnpm build
# or
npm run build
```

This should create a production bundle for your extension, ready to be zipped and published to the stores.

## Submit to the webstores

The easiest way to deploy your Plasmo extension is to use the built-in [bpp](https://bpp.browser.market) GitHub action. Prior to using this action however, make sure to build your extension and upload the first version to the store to establish the basic credentials. Then, simply follow [this setup instruction](https://docs.plasmo.com/framework/workflows/submit) and you should be on your way for automated submission!
