# Changelog

User-facing changes to the Ovrilo desktop app. Each release's notes are taken from its section here by the release workflow, so write for the people who use the app, not for developers.

## [0.2.0] - 2026-10-14

The first build that updates itself. Install it once by hand; later versions arrive in the app.

### New
- Join a voice channel with one click and see who is talking: their avatar lights up green.
- Push to talk, with any key or a mouse side button. It keeps working while a game has focus.
- Right-click someone to change how loud they are for you, or mute them just for yourself.
- See who is in each voice channel before you join.
- Ovrilo keeps running in the tray when you close the window, and your call continues.
- Connection details show latency, packet loss and when audio turned robotic, and save them to a file you can share when a call sounded bad.
- New look, new logo.
- Updates install from inside the app. During a call, Ovrilo asks before it restarts.

### Fixed
- Headsets and microphones that run at 44.1 kHz now work.
- Muting while deafened behaves like you expect: unmuting also undeafens.

### Known issues
- The installer is not code-signed yet, so Windows warns about an unknown publisher.
- Other people's deafen state is not shown; they appear as muted.
- Unplugging a headset during a call stops your audio until you rejoin.
