# Changelog

User-facing changes to the Ovrilo desktop app. Each release's notes are taken from its section here by the release workflow, so write for the people who use the app, not for developers.

## [0.4.1] - 2026-10-15

### Fixed
- Online status works: people who are online now show as online instead of offline.
- New messages from others appear right away, without switching channels.
- Reading a channel on one computer clears its unread count on your other ones (this was meant to work in 0.4.0).

## [0.4.0] - 2026-10-14

Put a face to the name: profile pictures, animated avatars and community icons.

### New
- Profile pictures. Upload a PNG, JPEG, WebP or GIF in Settings → Account; everyone in your communities sees it next to your name, in chat and in voice.
- Animated GIF avatars (up to 8 MB). They play when you point at them, so long member lists stay calm.
- Community icons. Owners can pick one from the button next to the community name.

### Known issues
- Pictures appear once your server has image storage set up. Until then, uploading says pictures are not available yet.
- Opening a channel you have never read counts its whole history as unread.
- Opening a channel shows the newest messages, not the first unread one.

## [0.3.0] - 2026-10-14

Text chat arrives. Your crew can now talk in text channels, not just voice.

### New
- Text channels: messages appear for everyone instantly, and you can edit or delete your own.
- Scroll up to read older messages. When new ones arrive while you are reading, a button takes you back down.
- A member list next to the chat shows who is online.
- Channels with unread messages stand out and show how many are waiting. A red "New" line marks where you stopped reading.
- Reading a channel on one computer clears its unread count on your other ones.
- Sending too many messages too fast shows a short countdown instead of failing. Your text stays in the box.
- If the connection drops, Ovrilo catches up on the messages you missed when it reconnects.

### Known issues
- Opening a channel you have never read counts its whole history as unread.
- Opening a channel shows the newest messages, not the first unread one.

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
