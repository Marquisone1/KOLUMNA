# Kolumna

Online card game for 2 to 6 players, German and English. Rules: twelve face-down cards in a 3×4 grid, flip two to start, then on each turn take the open card or draw from the deck, swap or discard-and-flip. Three equal cards in a column are cleared. Whoever reveals everything triggers one final turn for everyone else, and gets doubled if they are not strictly lowest. The game ends at 100 points (50/150 selectable); lowest total wins.

## Use in Google AI Studio

1. AI Studio → **Build** → start a new app, open the code editor.
2. Recreate the file tree below (or upload the zip if your AI Studio version offers import). The `index.html` already contains the import map AI Studio needs (React, PeerJS, three.js and @react-three/fiber from esm.sh; fiber is loaded with `?external=react,react-dom,three` so React and three exist only once).
3. No API key is needed. The app does not call Gemini.
4. Open the preview, create a room, share the 5-letter code. For friends on other devices, deploy/share the app (AI Studio "Deploy" or "Share") so everybody opens the same URL.

## Run locally

```bash
npm install
npm run dev        # http://localhost:3000
```

Add `?net=local` to the URL to play across tabs of one browser without any network (useful for testing).

## 3D table

The game is played in first person at a round table by default (three.js through @react-three/fiber). You see the table from your chair: your own cards in front of you, the others sitting across and beside you, a lamp hanging over the table. With a mouse, move the pointer toward the screen edges to look around (the middle, where your cards are, stays still); on touch screens drag. The view turns back to the table on its own. While you are on the start screen or in the lobby, the 3D table, the room, the fonts and the characters already load in the background; a short loading screen covers the table until everything is in. The **2D / 3D** switch in the top bar changes the view at any time, also mid-game; the choice is remembered. Without WebGL, or if the 3D view fails to start, the 2D table is used. `?view=2d` forces 2D.

- The game takes place in a **bar** around the table: counter with a bartender, two regulars at a high table, back bar with bottles, chalkboard, jukebox, dartboard, a rug under the table. The lamp over the card table is the main light; the rest of the room is lit indirectly. Rooms are separate modules in `components/three/rooms/`; more can be added there and picked by id.
- Hover over another player's cards (tap on touch screens) and a see-through copy of their grid appears beside yours, turned so you can read it.
- Opponents' cards and the piles are drawn a little larger than yours so they read across the table; they lie the way their owner sees them, as on a real table.
- Deck and discard pile sit on a **turntable** in the middle of the table that turns to face whoever's turn it is.
- When you hold a card drawn from the deck, the red **Discard** button in its brass bezel rises out of the table next to your cards.
- Card faces, backs, felt and wood are drawn on canvases at runtime; there are no image files.
- Every step from the engine is played as animate → commit → wait for the cards to land, for both views (`Animator` in `anim.ts`).
- Graphics come in two levels. **High** (desktops) adds ground-truth ambient occlusion, SMAA, the lamp's cone in the room's haze and softer shadows; **normal** (phones) skips those. Both get a soft bounce of green light from the felt. If frames stay slow, high steps down to normal by itself. `?gfx=high` or `?gfx=low` sets the level and keeps it.
- Phones: the pixel ratio is capped at 1.5, there is one shadow-casting lamp with a 1024 px shadow map, and frames are only rendered while something moves.

### Characters

The other players are animated characters from the **KayKit Adventurers** pack by Kay Lousberg (www.kaylousberg.com), CC0 1.0, slimmed to the six animations the game uses: they sit on their chairs, reach for a card when they draw or take one, swap, tap a card to flip it, cheer when they clear a column, go out or win a round, and wince when they get doubled. Their heads follow the game. The files are in `public/characters/` with the licence; the loader also looks under `public/` so the same paths work where the source tree is served as is (Google AI Studio). If a model cannot load, a simple placeholder figure sits there instead.

To use other models, list `.glb` files in `components/three/characterModels.ts`. A model is used fully when it has a seated clip, reaction clips and a `head` bone (the names are set in that file); anything else still loads and sits still.

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
anim.ts           Animator interface; 2D card flights, flips, layout shifts
useGame.ts        plays incoming steps: animate, then commit
game/types.ts     data model
game/engine.ts    rules
game/bot.ts       bot player (sees only public information)
net/transport.ts  PeerJS + BroadcastChannel transports
net/session.ts    host / guest sessions, reconnect
components/       Card, PlayerBoard, Table, Scoreboard, Screens, Icon,
                  useTableModel (what can be clicked, status line; shared by 2D and 3D),
                  viewMode (2D/3D choice, WebGL check)
components/three/ Table3D (canvas, room, lamp, camera at your eyes, name plates),
                  stage (card objects, flights, turntable, discard button), characters (people at the table),
                  rooms/ (the world around the table: Bar, room registry),
                  characterModels (your .glb files), layout (seats, eye position, camera fit),
                  textures (canvas-drawn cards), animator3d
```

Icons from lucide (ISC). Characters: KayKit Adventurers by Kay Lousberg, CC0 1.0. Design pass guided by unslop by Damir Sokolovsky (@heydamir), CC BY 4.0 (https://github.com/heydamir/unslop).
