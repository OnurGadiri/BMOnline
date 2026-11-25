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

### Gallows
- Walk up to the gallows and press **F** to open its panel.
- Create a fictional "prisoner" NPC in the character creator and pick a name from the preset list
  (`dummyNames` in `options.json`). Real players cannot be placed on the gallows and free-text names are not allowed.
- 3 slots, each prisoner stays for 2 minutes; any player can release them.

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
| `F` | Use the gallows (when nearby) |
| `C` | Open the character creator |
| `P` | Photo mode (hides the UI for screenshots) |
| `Enter` | Chat |
| `Esc` | Release the mouse / close panels |

The ⚙ **Settings** panel has mouse sensitivity, invert Y, mouse-lock mode and graphics quality (High / Low).

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
