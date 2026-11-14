# Kolumna

Online card game for 2 to 6 players, German and English. Rules: twelve face-down cards in a 3×4 grid, flip two to start, then on each turn take the open card or draw from the deck, swap or discard-and-flip. Three equal cards in a column are cleared. Whoever reveals everything triggers one final turn for everyone else, and gets doubled if they are not strictly lowest. The game ends at 100 points (50/150 selectable); lowest total wins.

## Use in Google AI Studio

1. AI Studio → **Build** → start a new app, open the code editor.
2. Recreate the file tree below (or upload the zip if your AI Studio version offers import). The `index.html` already contains the import map AI Studio needs (React, PeerJS from esm.sh).
3. No API key is needed. The app does not call Gemini.
4. Open the preview, create a room, share the 5-letter code. For friends on other devices, deploy/share the app (AI Studio "Deploy" or "Share") so everybody opens the same URL.

## Run locally

```bash
npm install
npm run dev        # http://localhost:3000
```

Add `?net=local` to the URL to play across tabs of one browser without any network (useful for testing).

## How online play works

- **PeerJS / WebRTC, no own server.** The host's browser runs the game; guests connect peer-to-peer via the free PeerJS signalling server.
- **The host is authoritative.** Guests only receive a public view: face-down values and the deck order never leave the host.
- **Reloads:** a guest that reloads rejoins their seat; a host that reloads restores the game in the same tab and guests reconnect automatically.
- If a player drops out, the host can let a bot take over their seat.

## Files

```
index.html  index.tsx  index.css  App.tsx  metadata.json
i18n.ts           German and English strings
audio.ts          synthesized card sounds (Web Audio)
anim.ts           card flights, flips, layout shifts
useGame.ts        plays incoming steps: animate, then commit
game/types.ts     data model
game/engine.ts    rules
game/bot.ts       bot player (sees only public information)
net/transport.ts  PeerJS + BroadcastChannel transports
net/session.ts    host / guest sessions, reconnect
components/       Card, PlayerBoard, Table, Scoreboard, Screens, Icon
```

Icons from lucide (ISC). Design pass guided by unslop by Damir Sokolovsky (@heydamir), CC BY 4.0.
