# Two-device streaming

## Routes

- `/controller` captures camera video, tracks face landmarks, renders the portrait to a canvas, applies a Tone.js pitch shift to microphone audio, then broadcasts the canvas and processed audio tracks with PeerJS/WebRTC.
- `/receiver` connects to the controller using the room link or room ID and plays the incoming stream full-screen. It does not request camera or microphone access.

The controller creates a PeerJS room. The receiver opens a PeerJS data connection and signals readiness; the controller then starts the media call. PeerJS provides signaling, while WebRTC transports media peer-to-peer where possible. Network environments that block direct connections may require TURN configuration; PeerJS does not guarantee relay connectivity.

## Running on two devices

1. Start the app on the laptop and open `/controller`.
2. Grant camera and microphone permissions and choose a portrait.
3. Select **Start broadcast**, then scan the QR code or open/copy the receiver link on the phone.
4. Keep both devices online and allow the phone browser to play audio.

Camera/microphone capture requires a secure context: HTTPS or localhost. A phone cannot treat the laptop's `http://192.168...` address as localhost. For LAN testing use an HTTPS development certificate/host that both devices trust; for internet use deploy behind HTTPS. The receiver URL must also be reachable from the phone.

## OBS and desktop apps

The controller canvas is the clean virtual-camera source. In OBS, add a **Browser** source pointed at the HTTPS `/controller` page, or capture the controller window and crop to the canvas. Start **OBS Virtual Camera** and select it as the camera in Zoom, Discord, or another desktop app. For audio, route the controller's processed audio output into OBS with a virtual audio cable such as VB-CABLE, then select that cable as the app's microphone. Avoid monitoring the same audio back through speakers to prevent feedback. Mobile apps generally cannot select another device's virtual camera directly; use the phone receiver page as the live view instead.

Use only likenesses and voices you have permission to use, and disclose when a stream is synthetic or modified.
