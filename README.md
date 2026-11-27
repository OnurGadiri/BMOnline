# BMU Online

A browser-based multiplayer 3D game set on the campus of Baku Engineering University (BMU).
Players create their own character, explore the campus together, chat, level up and fight —
and when they log off, their character stays on campus as a wandering NPC.

> **Status:** early prototype (v0.1). The campus layout follows satellite imagery; building details are stylized.

## Quick start

**Requirements:** [Node.js](https://nodejs.org/) 18 or newer.

On Windows, double-click `start.bat`. It installs dependencies on first run, starts the server and opens the game.

Or manually:

```bash
npm install
npm start
```

Then open <http://localhost:3000>. Friends on the same network can join via `http://<your-ip>:3000`
(find your IP with `ipconfig`; Windows Firewall may ask for permission).
Set the `PORT` environment variable to use a different port.

### Play online with friends (host on your own PC)

Double-click `start-online.bat`. It starts the server and opens a free
[Cloudflare quick tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/)
(installing `cloudflared` via winget if needed) and prints a public `https://….trycloudflare.com` link —
send it to your friends. The link works while the window stays open and changes on every start.
`tunnel.yml` keeps the quick tunnel independent of any `~/.cloudflared/config.yml` you may already have.

Login is protected against PIN guessing: 5 wrong PINs from one IP lock it for 10 minutes,
8 wrong PINs on one account lock that account for 15 minutes, and one IP can create at most 5 accounts per hour.

## Features

### Accounts & persistence
- Sign in with a name and a 4–8 digit PIN; new accounts are created automatically.
- PINs are stored as salted `scrypt` hashes in `data/players.json` (excluded from git).
- Your position, level, XP and character are saved between sessions.

### Character creator
- Six sections: **Presets**, **Body**, **Face**, **Hair**, **Clothes**, **Accessories**.
- Clearly distinct male and female body shapes (shoulders, waist, hips, jaw, eyelashes, lips).
- Body sliders: height, weight, muscle, leg length, head size.
- Face: face shape, eye shape and colour, brows, nose, mouth, lip colour, cheeks, facial hair.
- 13 hairstyles, 7 tops with printable patterns, 5 bottoms, 3 shoe types, headwear, glasses, bags, earrings and neck accessories.
- Live 3D thumbnails for hairstyles, headwear, glasses and presets.
- Undo / redo (`Ctrl+Z` / `Ctrl+Y`), per-section and full randomizer, preview poses.
- Re-open the creator in game at any time with **C**.

### Campus & world
- BMU campus rebuilt from satellite imagery and photos (~400 × 720 m, aligned to the campus axis):
  the brick Rectorate with its pink-and-white wings, the plaza with the "BEU" letters and flags,
  Prefabrik buildings, Yeni bina, football pitch, Economics building, the south building,
  the Languages building and tennis courts — plus the entrance avenue, parking lots and the residential
  towers, construction crane and highway traffic around the campus.
- Stylized graphics: gradient sky with sun glow, drifting clouds, ACES tone mapping, soft shadows,
  paved paths with curbs, hedges, flower beds, street lamps, grass, detailed building facades.
- Static NPCs defined in `campus.json` (e.g. Rəhman, who stands by the gallows with a speech bubble).

### Multiplayer
- Real-time movement sync over WebSockets (10 Hz snapshots with client-side interpolation).
- Chat, join / leave messages, kill feed.
- **Offline characters become NPCs** that walk the campus paths, pause, wave and dance —
  and you resume from wherever your NPC was when you log back in.
- Emotes: wave, dance, cheer (visible to everyone).

### Combat
- Two weapons: **fists** and a **pistol** (12-round magazine, manual or automatic reload).
- Over-the-shoulder aiming camera with crosshair; 100 HP with regeneration after 5 s without damage.
- Pistol: 22 damage, 55 on headshots, 70 m range. Fist: 12 damage at close range.
- Death animation, respawn after 6 s away from the attacker, 3 s spawn protection.
- +25 XP for defeating a player, +10 for an NPC. NPCs that get hit run away.
- **Server-authoritative:** hits, damage, fire rate, ammo and line of sight are validated on the server.
- Effects: tracers, muzzle flash, impact sparks, floating damage numbers, hit markers,
  damage vignette, overhead health bars and synthesized sound effects (no audio files needed).
- Tuning values live in the `W` object in `server/server.js`.

### Activities
- **Benches:** walk up to any bench and press **F** to sit (others see you sitting); move to stand up.
- **Football:** a shared, server-simulated ball on the pitch. Run into it to dribble; hold **F** to charge
  a kick and release to shoot in the direction you are looking. Goals are announced to everyone (+15 XP).
  The goals have posts, a crossbar and a net (back, sides and roof): a ball can only score by crossing the goal
  line from the pitch side, and it bounces off posts, nets and players' bodies instead of passing through them.
  Ball physics shared by the server and the client lives in `public/js/ballphys.js`.
- **Basketball:** hold **F** next to the ball on the volleyball court and release in the middle of the
  power bar to shoot at the hoop on the wall (+10 XP per basket).
- **Kapital Bank Room — C# exam cheating mission (multiplayer):** press **F** at the middle door of the
  rectorate to open the exam lobby, join a room or open a new one (**3–8 students** per room). The player who
  opened the room (👑 host) starts the exam with **▶ İmtahanı başlat** once at least 3 students have joined; after a
  5-second countdown everyone is seated in the Kapital Bank Room classroom
  (red graduation-cap wall, orange/yellow window wall, desks, screen) next to fictional NPC classmates.
  The (fictional) teacher writes on the board, turns around, watches the class and walks the aisles.
  Hold **F** at your desk to peek at your phone, or stand up, walk next to a classmate (NPC or player) and
  hold **F** to copy from their paper — fast, but they may be wrong. Answers (**1-3**) can only be written
  at your own desk. If the teacher sees you out of your seat or cheating, suspicion rises; when it is full
  you are thrown out of the exam and wait for the others to finish — or open a new room with new players.
  Latecomers can still join a running exam (**Gec qoşul ⏱**) while there is a free place and more than 30 seconds
  left; they get a free desk and the remaining time. A student who was thrown out cannot rejoin the same exam.
  Up to 3 exams can run at the same time; results and XP are announced when everyone has finished.
- **Fast travel:** press **T** (or 🧭 in the mobile menu) to teleport to the rectorate (exam lobby), the central
  plaza, the pitches, the gallows or the other buildings. Not available in combat (6 s without damage), during
  a match or an exam, and only every 10 seconds.
- **Volleyball:** a ball with a real net on the volleyball court. Press **F** to hit it over the net
  (hold **F** to charge a serve).
- **Matches (1v1 / 2v2):** inside the football pitch or the volleyball/basketball court, press **F**
  (or the 🏟 Matç button) to open the match panel, pick 1v1 or 2v2 and join the blue or red team. When
  both teams are full the match starts after a 5-second countdown, players are moved to their side and
  only match players can touch the ball (nobody during the countdown). The first kick-off / serve is drawn
  by lot; after a goal or basket the team that conceded kicks off (only they can touch the ball until their first
  touch or for 8 s), in volleyball the team that won the point serves. Football: first to 3 goals (3 min); basketball: first to 5
  baskets (2.5 min); volleyball: first to 7 points (4 min) — the ball landing in a side's court is a
  point for the other side, out of bounds is a point against the hitter. Winners get +40 XP and a win
  on the leaderboard (🏆); leaving a running match forfeits it.
- **Stars:** 18 golden stars are scattered around the campus (also shown on the minimap). Touch one to
  collect it (+5 XP); it reappears somewhere else after 45 seconds.
- **Leaderboard:** hold **Tab** to see the top players (level, kills, deaths, stars, goals/baskets).

### Gallows
- Walk up to the gallows and press **F** to open its panel.
- Create a fictional "prisoner" NPC in the character creator and pick a name from the preset list
  (`dummyNames` in `options.json`). Real players cannot be placed on the gallows and free-text names are not allowed.
- 3 slots, each prisoner stays for 2 minutes; any player can release them.
- Next to it stands the **Çarmıx** (crucifix) with three wooden crosses. It works the same way:
  press **F** nearby, create a fictional prisoner with a name from the list, and they appear on a
  cross with arms tied to the beam. Separate 3 slots, same 2-minute timer and release rules.

### Progression
- Earn XP by walking around and in combat; level-ups are announced to everyone.

## Controls

| Key | Action |
|---|---|
| `W` `A` `S` `D` / arrow keys | Move |
| `Shift` | Sprint |
| `Space` | Jump |
| Mouse drag, or click to lock the mouse | Rotate camera |
| `Q` / `E` | Rotate camera |
| Mouse wheel | Zoom |
| `G` | Switch between fists and pistol |
| Left click | Punch / shoot |
| `R` | Reload |
| `1` `2` `3` | Emotes: wave, dance, cheer |
| `F` | Interact: sit on a bench, kick / shoot a ball (hold to charge), use the gallows |
| `Tab` (hold) | Leaderboard |
| `C` | Open the character creator |
| `M` | Toggle the full campus map (a minimap is always shown) |
| `P` | Photo mode (hides the UI for screenshots) |
| `Enter` | Chat |
| `Esc` | Release the mouse / close panels |

The ⚙ **Settings** panel has mouse sensitivity, invert Y, mouse-lock mode and graphics quality (High / Low).

### Mobile (phones and tablets)

Touch controls appear automatically on phones and tablets (landscape is recommended):

- **Left side:** virtual joystick — push to the edge to sprint.
- **Right side:** drag anywhere to turn the camera.
- **Buttons:** 👊/🔫 attack, ⤒ jump, **F** interact (hold to charge kicks and shots), ⇄ switch weapon, ⟳ reload.
- **Top bar:** 💬 chat, 🗺 map, 🏆 leaderboard (hold), 👕 character, 😀 emotes, 📸 photo mode (double-tap to exit), ⛶ fullscreen.
- The character creator becomes a bottom sheet (portrait) or a side panel (landscape); graphics default to Low.
- Add `?touch=1` to the URL to try the touch controls on a computer (`?touch=0` forces mouse controls).

## Tests

```bash
npm test          # map validation + ball physics + server protocol tests
npm run test:map  # only the campus.json checks
```

- `tests/map.test.js` checks NPC routes and roads against buildings, graph connectivity,
  objects placed on roads or inside buildings, and overlapping areas.
- `tests/protocol.test.js` starts its own server on port 3101 with a temporary data folder
  (your `data/players.json` is never touched) and runs 35 multiplayer checks: login and
  character validation, sync, chat, teleport guard, shooting, ammo, death and respawn,
  punching, the gallows, brute-force protection and session takeover.

## Project structure

```
server/server.js          Game server: static files, WebSocket protocol, accounts, NPC AI, combat, gallows
public/index.html         Page layout and UI
public/style.css          UI styles
public/js/main.js         Game client: networking, input, camera, HUD, game loop
public/js/character.js    Procedural character model, animations, name tags, speech bubbles, pistol model
public/js/creator.js      Character creator UI and preview stage
public/js/world.js        Campus: buildings, paths, plaza, football pitch, gallows, collisions
public/js/decor.js        Sky, clouds, grass, hedges, flowers, street lamps, rocks
public/js/combat.js       Combat effects, sounds, health bars, aim raycasting
public/js/minimap.js      Minimap and full campus map
public/js/play.js         Balls (client-side prediction) and collectible stars
public/js/touch.js        Mobile touch controls (joystick, camera drag, on-screen buttons)
public/js/merge.js        Merges static meshes into vertex-coloured batches (fewer draw calls)
tests/                    Map validation and server protocol tests
public/data/campus.json   Map data: buildings, paths / NPC navigation graph, spawn, static NPCs
public/data/options.json  Character options, colour palettes, presets, prisoner names
start.bat                 One-click launcher for Windows
```

Tech stack: [Three.js](https://threejs.org/) on the client (no build step, ES modules),
Node.js with [`ws`](https://github.com/websockets/ws) on the server.

## Roadmap

1. More building details from photos (remaining facades, signage)
2. Building interiors (classrooms, library, cafeteria)
3. Mini-games (football, quizzes, races), quests and rewards
4. More weapons and vehicles
5. Possible port to a game engine (Godot or Unity)
