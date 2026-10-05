# lumen-telegram

Unofficial Telegram client for [Rokid Lumen](https://github.com/beyondlevi/rokid-lumen) glasses, built as a Meta Ray-Ban Display (MRBD) web app with the official
[UI Toolkit for Meta Ray-Ban Display](https://github.com/facebook/meta-ray-ban-display-ui-toolkit-web). It is
the sibling of `lumen-whatsapp` and has the same screens and controls. It signs in as **your Telegram user
account** over MTProto with [GramJS](https://gram.js.org) (`telegram` on npm), straight from the browser
through WebSocket, with no server in between.

> **Unofficial.** lumen-telegram ("Unofficial Telegram for Lumen") is an independent project built on
> the [Telegram API](https://core.telegram.org/api). It is not affiliated with, endorsed or sponsored
> by Telegram, Meta Platforms, Inc., or Rokid. Telegram is a trademark of Telegram, used here only to
> say what the app works with.
>
> **Your own API credentials.** Each user signs in with their own `api_id` and `api_hash` from
> [my.telegram.org](https://my.telegram.org) and must follow the
> [Telegram API Terms of Service](https://core.telegram.org/api/terms). The software is provided
> "as is", without warranty (see [LICENSE](LICENSE)).
>
> **Not yet supported: sponsored messages.** The API terms ask clients that show channels to show
> Telegram's sponsored messages in them. This app opens channels but doesn't fetch or show sponsored
> messages yet (`messages.getSponsoredMessages`).

- **Chats**: profile photo, name, preview, and time for the 40 most recent chats (archived chats excluded).
  Unread chats have an unread dot on the avatar and an accent-colored time. A chat without a name shows the
  phone number, and an icon in place of the photo. The last list and the 30 most recent messages of up to
  20 chats are cached in localStorage under a one-way digest of the account (never the API hash or the
  session). On launch the cached list shows at once, and the header shows "Loading…" with a spinner until
  the first refresh.
- **Conversation**: the 30 most recent messages, starting below the header, with the chat's photo in the
  header and sender names in groups. Videos, stickers, documents, locations, contacts and polls show a
  marker ("Video", "Document: …"); service messages (joins, title changes) are left out.
- **Photos**: Enter on a photo opens its menu with **View** first. View downloads the photo and shows it
  full screen on the dark window background, with a loader while it downloads and an error with
  **Try again** if it fails. Back returns to the same bubble.
- **Voice messages**: the bubble shows the length; Enter plays or pauses, with the position and a progress
  bar. The audio is downloaded on the first play. Telegram voice notes are OGG/Opus, which `<audio>` plays
  in GeckoView and in Chromium. One message plays at a time; playback stops when the conversation closes.
  Enter on a voice message opens its menu: **Listen** (it reads **Pause** while playing), **Transcribe**,
  the four reactions and Reply.
  - Audio files (music, an `.ogg` or `.mp3` sent as a file: `documentAttributeAudio` without `voice`, or
    any `audio/*` document) get the same playable bubble and menu, labeled "Audio" instead of "Voice
    message" (also in the list preview: "You: Voice message" / "You: Audio").
- **Sending voice notes**: **Voice** opens the recording screen, which records through the Lumen host's
  microphone API (see "Lumen audio API" below). Send uploads a native Telegram voice note:
  - an OGG/Opus document with `documentAttributeAudio` (`voice=true`, the duration in seconds, and the
    5-bit waveform);
  - the waveform is built from the input levels of the recording (`src/telegram/waveform.ts`, 100
    samples), so Telegram shows it as a voice message with its waveform;
  - it is sent with GramJS `sendFile({voiceNote: true, attributes})` (`upload.saveFilePart` +
    `messages.sendMedia`).
- **Reactions**: shown only as a badge under the bottom-right corner of the message (the emojis and, from 2
  on, the count). Telegram keeps reactions on the message itself (`messageReactions`), so they are never a
  bubble. Your own reaction shows at once; choosing it again removes it.
- **Allowed reactions**: the menu offers 👍 ❤️ 😂 😭, adjusted to what the chat accepts
  (`available_reactions` of the group or channel; Telegram's standard set otherwise, from
  `messages.getAvailableReactions`). When a chat does not accept one, its substitute is used (😂 → 🤣 or 😁,
  😭 → 😢). If no substitute fits, the item is disabled and reads "… is not allowed in this chat". A chat
  with reactions turned off shows all four disabled and the toast "Reactions are off in this chat".
- **Previews**: the newest message. A reaction is never previewed as a message. When someone else's unread
  reaction is the newest thing on your last message, the row reads `Reacted ❤️ to “…”`, with the sender's
  first name in groups.
- **Opening a conversation** from the list shows the newest message: the route would restore the focus
  and scroll of the previous visit (an older bubble, with newer ones under the rail), so the newest
  bubble gets the focus and the end is revealed. Back from a photo or a transcript keeps the bubble you
  were on.
- **Conversation actions**: a bottom rail with Reply, Voice (records a voice note when the host has
  `window.lumen.audio`, disabled otherwise) and Photos (disabled).
- **Reply**: the text field (the toolkit's `InputTextView`) appears only after Reply, as its own history
  entry, so Back closes it and focus returns to Reply. On the glasses, Enter on the field opens the
  platform's dictation composer. Right then moves to Send. After sending, the field closes.
- **Message menu**: View (photos), the four reactions, and Reply, which opens the field quoting that
  message. Replies are sent with Telegram's native `reply_to`.
- **Read state**: opening a chat marks it read up to its newest incoming message (`markAsRead`, which uses
  `messages.readHistory` or `channels.readHistory`).
- **Updates**: Telegram pushes updates over the open connection. A new message, edit, deletion, reaction or
  read in a chat refreshes it (and the list) within half a second. Polling covers missed updates: the open
  conversation every 10 s, and the list every 20 s. Polling pauses while the page is hidden.
- **Language**: English by default; Portuguese (pt-BR wording) for any `pt-*` `navigator.language`,
  including the glasses' `pt-PT`. All UI strings are in `src/i18n/strings.ts`.

## Controls

The app uses only arrow keys, Enter, and Escape (the Neural Band / Rokid gestures).

| Where | Key | Action |
|---|---|---|
| Chats | Up / Down | Move between chats |
| Chats | Enter | Open the chat |
| Chats | Escape | Not handled by the app, so the platform closes it |
| Chats | Up from the first chat, Enter | Voice search (the row above the chats; only when the device offers speech recognition) |
| Voice search | (speak), then pause or Enter on Done | Ends the listening; the matching chats and contacts are listed, best first, with the first one focused |
| Voice search results | Enter | Opens the chat (or a new conversation with a contact); Back from it returns to the list |
| Voice search | Enter on Try again / Search again | Listens again |
| Voice search | Escape | Back to the list (stops listening) |
| Conversation | Up / Down | Move between the message bubbles (scrolls history) and the action rail |
| Conversation, on a message taller than the screen | Down / Up | Scroll through that message, half a screen per press, until its end (Down) or start (Up) is in view; the next press goes on to the next/previous message. A long message reached with Down opens at its start, with Up at its end |
| Conversation | Down, Left | Always ends on Reply (on entry, focus is on Reply or on the newest bubble) |
| Conversation | Enter on Reply | Opens the reply field, focused |
| Reply field | Enter | On the glasses: opens the platform's dictation composer. In a desktop browser: sends |
| Reply field | Right, then Enter | Send; the field closes |
| Reply field | Escape | Closes the field, back to Reply |
| Conversation | Enter on a bubble | Opens the message menu |
| Conversation | Enter on a voice message | Opens its menu: Listen/Pause, Transcribe, reactions, Reply |
| Conversation | Enter on Voice | Opens the recording screen |
| Recording | Enter on Send (initial focus) | Stops, sends, returns to the conversation on Voice |
| Recording | Right, Enter (Discard) or Escape | Cancels without sending |
| Transcript | Escape | Back to the voice message (the transcript stays under it) |
| Message menu | Left / Right, Enter | View (photos), a reaction, or Reply (quoted reply) |
| Message menu | Escape | Closes the menu, back to the bubble |
| Photo | Escape | Back to the conversation, on the same bubble |
| Conversation | Escape | Back to the chat list, with the same chat focused |
| Error screens | Enter on "Try again" | Connects again |
| Setup screen | Enter on "Check again" | Reads the configuration again |

## Connecting a Telegram account

The app needs three values, filled in on the phone companion (Lumen app → Apps → Telegram):

```json
"lumen_config": [
  {"key": "telegram.apiId", "label": "API ID (my.telegram.org)", "type": "text"},
  {"key": "telegram.apiHash", "label": "API hash (my.telegram.org)", "type": "secret"},
  {"key": "telegram.session", "label": "Session (npm run login)", "type": "secret"},
  {"key": "demo", "label": "Demo mode (screenshots)", "type": "text", "optional": true}
],
"lumen_internet": true
```

1. **API ID and hash.** Sign in at [my.telegram.org](https://my.telegram.org) → *API development tools*
   and create an application (any title, platform "Other"). Telegram shows the `api_id` (a number) and the
   `api_hash` (32 letters and digits). See [Obtaining api_id](https://core.telegram.org/api/obtaining_api_id).
2. **Session.** On a computer with Node 22: clone this repository, `npm ci`, then `npm run login`. It asks
   for the API ID and hash, the phone number, the code Telegram sends to your other devices, and the 2FA
   password if the account has one. It prints a session string, one line of a few hundred characters.
   Nothing is written to disk.
3. In the Lumen app, paste the three values and save. The glasses connect at once; if the app is open, the
   change applies without reopening it.

The session is **full access to the account**. Keep it only in the Lumen companion; the app reads it from
`window.lumen.config` and holds it in memory, never in localStorage. To revoke it, open Telegram → Settings
→ Devices and end "Rokid Lumen". After that the glasses show "Session not accepted", and you run
`npm run login` again.

At runtime the app calls `await window.lumen.config.get()` and subscribes with
`window.lumen.config.onChange(cb)`; see `src/config/lumenConfig.ts`.

- If any field is missing, the app shows the **Setup** screen, which names the missing fields.
- A malformed API ID, API hash or session shows **Invalid …**, naming the field.

### Demo mode

The field is marked `"optional": true`, so the companion does not ask for it (older Lumen versions ignore
the flag). For screenshots and videos, set **Demo mode (screenshots)** to exactly `demo-captures`
(surrounding spaces are ignored; any other value is ignored). The account fields can stay filled in. The
change applies at once, even with the app open. Clear the field to go back to the account.

In demo mode:

- the chats come from `src/demo/demoData.ts`, fictional and in English. Phone numbers use the
  555-0100–0199 range reserved for fiction, and the newest message is at 09:41 "today";
- `src/demo/demoClient.ts` serves them through the same `ChatApi` as the Telegram client. It never opens a
  connection, and GramJS is not even loaded. Sending takes 0.6 s; Maya Chen and Sam Rivera answer your
  first reply once, after about 2.5 s, delivered as a push update;
- it covers stacked reactions (Hike Crew), a reaction on your message (Maya), a reaction preview (Sam),
  allowed reactions (🤣 for 😂 everywhere; 😢 for 😭 in Hike Crew; a channel, Library News, with reactions
  off), profile photos and fallbacks (initials for Jordan Lee, an icon and a number for the unknown
  contact), two photos to View, a 6 s voice note, a poll, a document and a location;
- pictures and the voice note are generated by `scripts/generate-demo-media.mjs` (abstract shapes, dark
  backgrounds for the additive display, a synthesized tone melody in OGG/Opus) and ship in the package;
- the app reads and writes no storage, and every launch starts from the same unread chats;
- the copy is in English whatever the device language;
- voice search is always offered, with a simulated recognizer that "hears" *Maia* (one letter off) and
  lists Maya Chen first, with no microphone.

The only request outside the package origin is the Toolkit's Noto Sans stylesheet
(`fonts.googleapis.com`), which `<App>` adds in both modes.

### Development fallback

When `window.lumen` does not exist (a regular browser), the app reads
`?telegram.apiId=…&telegram.apiHash=…&telegram.session=…` (or `?demo=demo-captures`). It keeps the values in
memory for that page load only and removes them from the address bar.

## Telegram over MTProto (GramJS)

Checked against the Telegram documentation and measured in headless Chromium and Firefox
(see `tests/live/transport.mjs`):

- **Transport.** WebSocket: `wss://<dc>.web.telegram.org/apiws` on port 443, subprotocol `binary`
  ([transports](https://core.telegram.org/mtproto/transports)). The app forces `useWSS: true`; GramJS's
  default on an `http://` page would be `ws://` on port 80. A desktop login stores the DC's IP address in
  the session, which has no TLS certificate, so the app swaps it for the DC's web host (`pluto`, `venus`,
  `aurora`, `vesta`, `flora`), keeping the key.
- **GramJS in the browser.** GramJS is written for Node, so the build adapts it:
  - `vite.config.ts` aliases `crypto` to GramJS's own browser crypto and `path` to `path-browserify`;
  - `os`, `util`, `fs`, `net` and `socks` go to small stand-ins in `shims/`, and so do the parts the app
    never uses (`htmlparser2` for the HTML parse mode, and the `mime` type database);
  - `src/telegram/polyfills.ts` installs `Buffer` and `process`.

  GramJS is a separate chunk (~166 KB gzip) loaded with a dynamic import only when an account is
  configured. The first load stays around 224 KB gzip, and demo mode never loads it.
- **Session refused.** When Telegram does not know a session's key, it closes the WebSocket and GramJS keeps
  reconnecting. After a 20 s connect timeout the app opens one plain WebSocket to the DC. If it opens, the
  server is reachable, so the session was refused: "Session not accepted" (`AUTH_KEY_UNKNOWN`). Otherwise
  the network is down. `AUTH_KEY_UNREGISTERED`, `SESSION_REVOKED`, `USER_DEACTIVATED*` and `API_ID_INVALID`
  also map to "Session not accepted"; `FLOOD_WAIT_n` to "Too many requests" (wait n s).
- **Calls used.** `messages.getDialogs`, `contacts.getContacts` (voice search), `messages.getHistory`, `messages.sendMessage` (with `reply_to`),
  `messages.sendReaction`, `messages.readHistory` / `channels.readHistory`, `messages.getFullChat` /
  `channels.getFullChannel` (`available_reactions`), `messages.getAvailableReactions`,
  `upload.getFile` (photos, voice notes, profile photos), `upload.saveFilePart` + `messages.sendMedia`
  (voice notes: `inputMediaUploadedDocument`, `audio/ogg`, `documentAttributeAudio` voice/duration/
  waveform; see [documentAttributeAudio](https://core.telegram.org/constructor/documentAttributeAudio) and
  [files](https://core.telegram.org/api/files)), and the update stream. Transcription uses the Lumen host;
  `messages.transcribeAudio` (Telegram Premium) is not used.

### Errors

| Condition | Screen |
|---|---|
| Telegram unreachable (offline, DNS, TLS, proxy, timeout) | "Can't reach Telegram" |
| Session or API ID refused | "Session not accepted" (with Telegram's error code) |
| `FLOOD_WAIT_n` | "Too many requests" |
| Other errors | "Telegram error" |
| Malformed configuration | "Invalid API ID / API hash / Session" |

The phone's internet can take 5–15 s to come up after launch. On the first load, network failures are
retried every 3 s for up to 30 s while the header shows the **Loading…** spinner, over the cached list
when there is one. Only after that does it show the network error; with a cached list, the list stays and
the header shows **Offline** instead. A refused session stops at once, with no 30 s wait.

After the first load, a failed refresh keeps the data on screen, shows "Connection lost. Retrying…", and
marks the header **Offline** until a refresh succeeds.

### Known limitations and risks

- **MRBD quality gate: JavaScript budget.** The gate adds up every script in the package against the
  300 KB first-load budget. App and Toolkit (~224 KB gzip) plus the GramJS chunk (~166 KB) come to
  ~389 KB, so that check fails, although GramJS loads only after the first screen and only for a real
  account. All other checks pass (run on a copy without the GramJS chunk).

  What cannot be cut without breaking MTProto:
  - the Telegram type schema (~40 KB gzip);
  - pako (`gzip_packed` replies);
  - big-integer;
  - Buffer.

  Even trimming the schema's unused methods would save ~17 KB at most. Meeting the budget needs a bridge
  server (TDLib or GramJS on a server) that the app reaches over HTTPS, the way lumen-whatsapp reaches
  Evolution. The session would then live on that server.

- **WebSocket through the phone's proxy (to measure on the glasses).** In a local test, through a local
  HTTP CONNECT proxy:
  - Chromium completed the MTProto handshake and a call;
  - Firefox's first WebSocket through the proxy failed in every run, and the GramJS retry succeeded.

  The app retries (GramJS 5 times, then the 30 s window). Whether GeckoView 156 sends `wss` through the
  Lumen proxy is still untested.
- **No HTTP transport fallback.** Telegram's HTTP transport (`https://<dc>.web.telegram.org/apiw`) answers
  CORS with `Access-Control-Allow-Origin: *`, so a browser could use it. GramJS has no HTTP transport,
  though, and adding one means sending `http_wait` with every request to receive results and updates
  ([service messages](https://core.telegram.org/mtproto/service_messages)). That is not in 0.1.0.
- **GramJS is archived.** `telegram@2.26.22` is pinned; npm marks the package as archived, with
  [teleproto](https://www.npmjs.com/package/teleproto) as the maintained fork. teleproto dropped GramJS's
  browser dependencies and has not been tried in a browser here.
- **Profile photos** are downloaded once per session (two at a time) and kept in memory, not stored.
- **Media**: only photos (View) and voice/audio messages (play) are downloaded. Videos, stickers and
  documents keep their marker. Downloads live in memory for the session (the last 6).
- **Secure context.** GramJS relies on Web Crypto; `http://127.0.0.1` (how the Lumen host serves packages)
  is a secure context in Chromium and Firefox.
- **Channels** are read-only for most users: Reply returns "Not sent: not allowed in this chat".

## Lumen audio API (voice notes and transcription)

On the Rokid glasses `getUserMedia` is muted for apps, so the app never uses `getUserMedia` or
`MediaRecorder`. The phone captures the glasses' microphone and transcribes, and the Lumen host exposes
that as `window.lumen.audio` (`src/audio/lumenAudio.ts`):

```ts
interface LumenAudio {
  record(options?: {maxMs?: number}): Promise<LumenRecording>;      // the app asks for 120000 (2 min)
  transcribe(audio: Blob, options?: {language?: string; onPartial?: (text: string) => void;
    signal?: AbortSignal}): Promise<{text: string}>;
}
interface LumenRecording {
  onLevel: ((level: number, elapsedMs: number) => void) | null;  // ~5 times a second
  onEnd: ((reason: 'max' | 'error', result?: LumenAudioResult, error?: Error) => void) | null;
  stop(): Promise<LumenAudioResult>;                               // {blob, mimeType, durationMs}
  cancel(): void;
}
// Rejections carry .code: busy, no-phone, unavailable, too-large, unsupported-format, no-speech,
// engine (with .message), cancelled, timeout.
```

- **Feature detection**: the API is used only when `window.lumen.audio` has `record` and `transcribe`.
  On older hosts, **Voice** stays disabled and **Transcribe** is shown disabled ("not available on this
  device").
- **Recording screen** (`/chat/:id/record`, its own history entry):
  - shows the elapsed time, a microphone level bar (from `onLevel`) and **Send** (initial focus) /
    **Discard**;
  - "Starting…" with a spinner until `record()` resolves (the phone confirms the microphone in about
    0.5–2 s); Send keeps the focus but does nothing yet;
  - the level bar shows `min(1, level × 3)`: the host's level is 0..1, normal speech gives 0.15–0.3 and
    silence 0;
  - Send stops, shows "Finishing…" with a spinner and Send disabled until `stop()` resolves (on the
    glasses the file arrives about 4 s later, encoded and sent over in parts), then sends;
  - Discard or Back cancels without sending, also while finishing;
  - at 2:00 the host ends the recording (`onEnd('max', result)`), and the screen says so and keeps
    Send / Discard;
  - while sending, a spinner; then the Toast "Voice message sent", and the conversation shows the note
    in view above the rail, playable at once from memory (the route restores the previous scroll, so the
    end of the conversation is revealed again after that restoration);
  - the sent message is kept as yours (`fromMe`) whatever the response's `out` flag says.
  - host errors show a message with **Try again**.
- **Transcription screen** (`/chat/:id/transcript/:messageId`, Back closes):
  - downloads the voice note like Listen, calls `transcribe`, and shows the partial text live, then the
    final text;
  - the transcript is kept in memory for the session (opening it again is instant) and also shows under
    the voice bubble;
  - errors (busy, no-phone, too-large, no-speech, engine, …) have their own message and **Try again**;
  - Back aborts a running transcription (`signal`).
- **Demo mode** uses a simulated `window.lumen.audio` (`src/audio/demoAudio.ts`):
  - timings like the glasses: the microphone starts after 1 s, the audio arrives 2 s after Send, and the
    transcript takes about as long as the 6 s note;
  - a speech-like level (0.15–0.3, 0 between phrases), and the packaged demo voice note as the recording;
  - a fixed English transcript delivered word by word;
  - no microphone, no network, no storage.

## Voice search

The row **Voice search** above the chats (one Up from the first chat, which keeps the initial focus)
opens `/search`, which listens for a name and lists the chats and contacts that match it.

Speech (`src/search/voiceInput.ts`), from what the page has, best first:

1. `SpeechRecognition` / `webkitSpeechRecognition` (Lumen's shim serves it with the dictation engine
   chosen in the companion): `lang` is `navigator.language` (the engine may use its own), one phrase
   (`continuous: false`), `interimResults: true`. The partial text is shown as it comes; a pause (the
   engine's end of speech) or Enter on **Done** (`stop()`) ends it; Back calls `abort()`.
2. `window.lumen.audio`: `record({maxMs: 10000})`, ended after 1.2 s below level 0.06 that follows speech
   (level ≥ 0.1), after 6 s with nothing said, or by **Done**; then `transcribe(blob, {language:
   navigator.language, onPartial})`, whose partial text is shown.

With neither (a desktop browser without speech, Meta Ray-Ban Display's browser today), the row is not
shown. A recognizer that fails as unavailable (`not-allowed`, `service-not-allowed`, `audio-capture`,
`language-not-supported`, or Lumen's `unavailable`) is not used again in the session: the next one takes
over at once, and with none left the screen says so and the row disappears.

Matching (`src/search/nameMatch.ts`) ignores accents, case and punctuation, and the words said around a
name in English and Portuguese ("conversa com a Carla", "open the chat with Maya"). Each spoken word takes
the best word of the name: exact 1, a prefix of three letters or more 0.85, one letter wrong, missing,
extra or swapped 0.8 (for words of three letters or more), a prefix with one mistake 0.65, two mistakes in
words of seven letters or more 0.6. The score averages the spoken words, weighs how much of the name was
said, and adds a little when the first word matches the first name. Names said joined or split
("anapaula" / "Ana Paula") and four or more digits of a phone number also match. Below 0.5 nothing is
listed; equal scores list recent chats first, then contacts. Up to eight results.

Candidates are the list's chats and the saved contacts (`contacts.getContacts` through GramJS, fetched
once per connection while the wearer speaks; their access hashes are kept, so a contact's conversation
opens like a chat's). A contact without a chat opens an empty conversation under the contact's name; the
first reply starts the chat. Opening a result replaces the search in the history, so Back from the chat
returns to the list.

## Opening from notifications

The manifest's `lumen_notifications` offers this app for notifications from Telegram for Android
(`org.telegram.messenger`, `org.telegram.messenger.web`, `org.telegram.messenger.beta`). Lumen opens
`/notification/{shortcut}`; a chat notification's shortcut is `ndid_<dialogId>`, Telegram for Android's
dialog id: a user's id (positive), `-chatId` for a basic group, `-channelId` for a channel or supergroup
(without the `-100` of the marked ids that GramJS and this app use, so `ndid_-1194773306` is chat
`-1001194773306` or basic group `-1194773306`). The app looks for the chat in the loaded (or cached) list,
then asks Telegram (PeerUser, PeerChannel, PeerChat), and replaces `/notification/…` with the conversation,
so Back from it goes to the chat list. A shortcut that is not `ndid_<number>`, or a chat that cannot be
found, opens the list; channel posts, whose notifications have no shortcut, open the list too (Lumen
starts at `/`). While it looks, the loading screen is shown. In demo mode the fictional chats answer to
their own dialog ids (`ndid_7700101` is Maya Chen, `ndid_-1000000042` Library News).

## Development

```sh
npm ci
npm run dev           # http://localhost:5173/?demo=demo-captures (or the telegram.* parameters)
npm run login         # creates a session (see above)
npm run media         # regenerates the demo pictures and voice note (needs ffmpeg with libopus)
npm run icons         # regenerates the app icon
```

## Build and package

```sh
npm run build         # typecheck + production build into dist/
npm run package       # build + dist/lumen-telegram.mrbd.zip
```

The `.mrbd.zip` is the contents of `dist/` at the zip root. The manifest `id` is `cloud.bynd.lumen.telegram`.
`scripts/package-offline.mjs` fails the build in any of these cases:
- the manifest lacks `id`, the `lumen_config` keys, `lumen_internet: true`, a `version` equal to
  `package.json`'s, or a square PNG icon ≥ 192 px;
- the API hash or the session is not a `secret` field;
- any script contains the E2E fake Telegram.

The build targets Chromium 95 (the system WebView) and Firefox 115+ (GeckoView is Firefox 156).

## Tests

```sh
npm test                                          # unit tests
npx playwright install chromium firefox           # once
npm run package && npm run build:e2e && npm run test:e2e
npm run test:live                                 # needs internet; LIVE_PROXY=1 adds a CONNECT proxy
```

- **Unit tests** (`tests/unit`):
  - configuration parsing, and credentials kept out of storage;
  - MTProto → app conversion with real GramJS `Api` objects: every media kind, reactions, recent
    reactions, dialogs;
  - error mapping;
  - allowed-reaction choice and toggling, and list previews;
  - the demo client (no connection, allowed reactions, auto-reply with a push update);
  - where the list scrolls through a long message, step by step, in both directions;
  - notification shortcuts: `ndid_<dialogId>` parsing and the mapping to chat ids (user, basic group,
    supergroup/channel, garbage), and the GramJS lookup order;
  - voice search: name matching (accents, case, one-letter mistakes, prefixes, joined words, filler words,
    digits) and both speech paths (SpeechRecognition and `window.lumen.audio` with pause detection).
- **E2E** (`tests/e2e/run.mjs`, keyboard only, Chromium and Firefox). It serves two builds like the Lumen
  host does:
  - the **release build**: demo mode (the capture script key by key, with every outside request
    recorded, storage seeded with sentinel data and checked unchanged, pt-PT forced to English), the
    Setup and Invalid screens, the unzipped `.mrbd.zip` with every other origin blocked, and a real
    account start with Telegram unreachable (GramJS chunk loaded, `wss://…/apiws` attempted, "Can't reach
    Telegram" after the 30 s window);
  - an **E2E build** (`npm run build:e2e`), in which `tests/e2e/fakeTelegram.ts` replaces the GramJS
    connection, for the account flows: list, previews, photos and fallbacks, thread, dictated reply,
    `reply_to`, reactions (badge, toggle, allowed set, reactions off), read marking, push updates and the
    polling fallback, photo View/Back/failure, voice playback, Session not accepted, flood wait, the
    connection coming up late, Offline and back, the cached launch (and no credential in storage), the
    `window.lumen.config` contract, pt-PT, and long messages (the first, the middle and the last of five are
    taller than the screen: Down and Up scroll through each one before going on, the list never jumps on the
    way, and the message menu keeps the reading place; `tests/e2e/longMessages.mjs`, shared with
    lumen-whatsapp), and voice search (`tests/e2e/fakeSpeech.mjs` scripts a `SpeechRecognition`;
    `fakeAudio.mjs` the `window.lumen.audio` path, with a pause): the row hidden without speech, one Up from
    the first chat, partial text, a one-letter mistake, no accents, a contact without a chat (Bruno Lima,
    whose first message adds the chat to the list), no match and Try again, Done, Search again, no speech,
    Back aborting the recognizer, a recognizer refused as unavailable (the row then hidden, or
    `window.lumen.audio` taking over), and pt-PT; and opening from a notification (`/notification/ndid_…` for
    a user and a basic group in the list, a supergroup that is not, garbage and an unknown id, Back to the
    list). Native recognizers are removed from every test page.
- **Live** (`tests/live/transport.mjs`): the release build against Telegram's servers, with a random
  session and no account.

CI (`.github/workflows/ci.yml`) runs the unit tests, the package, the E2E build and the E2E suite, and
uploads the `.mrbd.zip` and the screenshots. A separate job runs the live check without failing the build.

Voice notes and transcription (`tests/e2e/fakeAudio.mjs` injects a scripted `window.lumen.audio`, in
Chromium and Firefox):
- recording, Send, Discard, Back and the 2-minute limit (`maxMs: 120000`, `onEnd('max')`);
- a host as slow as the glasses (start 1.5 s, file 2 s after `stop()`): "Starting…", "Finishing…" with
  Send disabled and focused, Enter ignored while finishing, Back while finishing sends nothing;
- after sending, the note is on screen above the rail, Up from Voice reaches it, the list reads "You: Voice
  message", and reopening the chat shows and focuses it (0.2.0 left it under the rail);
- an audio file that is not a voice note is a playable "Audio" bubble with Listen and Transcribe;
- the voice note sent with its length and 100-sample waveform (checked on the scripted Telegram); a unit test runs the real GramJS `sendFile` with the network replaced and checks the upload and the `documentAttributeAudio`;
- the `busy` and `no-phone` errors and Try again;
- the voice menu (Listen, Pause, Transcribe);
- transcription: partials, the kept transcript, an `engine` error and Try again;
- Voice and Transcribe disabled without the API;
- the demo capture script records, sends and transcribes with the simulated API.

Headless browsers do not replace a test on the glasses (GeckoView, the proxy, the dictation composer, the
Back gesture).

## License

GPL-3.0-or-later, see [LICENSE](LICENSE). Copyright (c) 2026 Levi Nóbrega.

The built package (`.mrbd.zip`) includes [GramJS](https://github.com/gram-js/gramjs) (MIT) and, through
it, `@cryptography/aes` (GPL-3.0-or-later), so the app as a whole is distributed under the GPL.

Third-party:

- The screens follow the [UI Toolkit for Meta Ray-Ban Display](https://github.com/facebook/meta-ray-ban-display-ui-toolkit-web)'s
  messaging example, Copyright Meta Platforms, Inc., Apache License 2.0; `src/components/MessageBubble.tsx`
  is adapted from it. The toolkit packages (`@wearables-ui-toolkit/mrbd`, `foundation`) are Apache-2.0;
  `@wearables-ui-toolkit/icons`, bundled into the built `.mrbd.zip`, is under the Meta Wearables
  Developer Terms.
- Other runtime dependencies are MIT, ISC, BSD, Apache-2.0, 0BSD or Unlicense (see `package-lock.json`).
