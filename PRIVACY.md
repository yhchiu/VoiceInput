# Privacy Policy — Voice Input

_Last updated: 2026-06-19_

Voice Input is a Chrome extension that converts your speech into text and
inserts it into editable fields on web pages. This policy explains what the
extension accesses, what leaves your device, and what it does **not** do.

## Summary

- The extension has **no servers of its own** and operates entirely inside your
  browser.
- It does **not** collect, store, sell, or transmit your audio or transcribed
  text to the developer or to any third party controlled by the developer.
- Speech recognition is performed by your browser's built-in **Web Speech API**.
  In Google Chrome, this means the captured audio is sent to **Google's speech
  recognition service** for processing. This transfer is performed by the
  browser, not by this extension, and is governed by
  [Google's Privacy Policy](https://policies.google.com/privacy).

## What the extension accesses

### Microphone audio
When you start voice input, the extension asks your browser for microphone
access and streams audio to the browser's Web Speech API only while a
recognition session is active. Audio is **not** recorded, stored, or written to
disk by the extension. When you stop, the microphone stream is released.

### Recognized text
The text returned by the speech service is held in memory only long enough to
show you the result and insert it into the field you selected. Optionally:

- **Common phrases** you create are saved as part of your settings so you can
  reuse them.
- **Scratchpad text** is saved **only if you explicitly enable** scratchpad
  saving in the options.

Both are stored locally in browser storage (see below) and are never sent to
the developer.

### Settings
Your preferences (recognition language, number of alternatives, side panel
mode, common phrases, etc.) are stored using `chrome.storage.sync`. Chrome may
synchronize this data across the devices where you are signed in to the same
Chrome profile. This synchronization is provided by Chrome and is governed by
Google's Privacy Policy. The developer has no access to this data.

### Web page content
The extension runs a content script on web pages so it can detect the editable
field you have focused and insert recognized text at the cursor. It reads only
the focus state and the field needed to insert text. It does **not** read,
collect, or transmit page content, browsing history, URLs, form data, or
credentials.

## Data we collect and share

| Category | Collected? | Shared with developer? |
|----------|-----------|------------------------|
| Audio (microphone) | Processed in real time by the browser; not stored by the extension | No |
| Transcribed text | Held in memory to insert; phrases/scratchpad stored locally if you opt in | No |
| Settings | Stored in `chrome.storage.sync` | No |
| Page content / browsing history / URLs | Not collected | No |
| Personally identifiable information | Not collected | No |
| Analytics / telemetry / tracking | None | No |

We do **not** sell or transfer your data to third parties, use it for purposes
unrelated to the extension's single purpose (voice-to-text input), or use it to
determine creditworthiness or for lending.

## Third-party processing

Because the extension relies on the browser's Web Speech API, audio you speak
during a recognition session may be transmitted by Google Chrome to Google's
speech recognition servers to produce a transcript. This is standard browser
behavior and is outside the control of this extension. If you do not want audio
sent to Google, do not start voice input.

## Remote code

The extension does **not** load or execute any remote code. All scripts are
bundled in the published package.

## Permissions and why they are needed

- **`storage`** — save your settings, common phrases, and optional scratchpad
  text locally.
- **`activeTab`** — interact with the page you are actively using to insert text.
- **`sidePanel`** — provide the optional side panel interface for recognition.
- **Microphone (requested at runtime)** — capture audio for speech recognition.
- **Host access to pages** — run the content script that finds your focused
  field and inserts text on the sites where you use voice input.

## Changes to this policy

If this policy changes, the "Last updated" date above will be revised and the
updated policy will be published in the extension's repository.

## Contact

Questions about this policy can be raised via the project's issue tracker:
<https://github.com/yhchiu/VoiceInput/issues>
