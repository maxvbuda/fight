# Neon Brawl

A 3D fighting game for up to four fighters. It runs in the browser on computers and on Apple Watch. There are no build steps and no asset files.

**Play:** https://maxvbuda.github.io/fight/

## Modes

- **On this computer:** pick 2, 3 or 4 fighters and 1 to 4 players. CPU fighters (Easy, Normal or Hard) fill the empty spots. Players 1 and 2 share the keyboard, and players 3 and 4 use gamepads.
- **Online rooms:** one player hosts and gets a 5-letter room code. Up to 3 friends join with the code from a computer or an Apple Watch, and any room can be hosted from either one. The host picks the number of fighters, and CPUs fill the empty spots. If someone leaves mid-match, a CPU takes over their fighter.

With 3 or 4 fighters it's a free-for-all. Each fighter faces the nearest opponent, and attacks hit anyone in front of them. The last fighter standing wins the round, and the first to win two rounds wins the match.

## Controls

| Action | Player 1 (and online) | Player 2 | Gamepad |
|---|---|---|---|
| Move | W A S D | Arrow keys | Left stick |
| Jump | Space | Right Shift / Num 0 | A |
| Punch | J or F | , / Num 1 | X |
| Kick | K or G | . / Num 2 | Y |
| Block (hold) | L or H | / / Num 3 | RB |
| Super (full meter) | U or R | ; / Num 4 | B |

After you land a hit, press punch or kick again to chain a combo. Dealing and taking damage both fill the super meter, and a super can't be interrupted once it starts.

## Apple Watch

Open the link on the watch (for example, by sending it to yourself in Messages and tapping it). Small screens and browsers without WebGL load `watch.html`, which draws the same 3D fighters on a 2D canvas. The watch can fight the CPU with 2 to 4 fighters, and it can host or join online rooms.

- **◀ ▶**: walk toward or away from the nearest fighter. Holding away while someone attacks blocks.
- **P / K**: punch and kick.
- **SUPER**: appears when your meter is full. Tap it to fire.
- **Tap the arena**: jump.

On the watch, the CPU is gentler and rounds last 60 seconds. Online play works on the watch too: it needs only plain HTTP requests, not WebRTC or WebSockets. To force the full version on a small screen, add `?full` to the URL.

## Code

- `sim.js`: rules, physics, CPU and rounds, shared by both versions so either can host a room.
- `net.js`: online rooms. Everyone connects to a small relay (`relay/`, a Cloudflare Worker with one Durable Object per room): computers by WebSocket, the Apple Watch by HTTP long polling. The host runs the simulation; guests send inputs and draw the host's snapshots.
- `relay/`: the relay. Deploy with `cd relay && npx wrangler deploy`, then put its URL in `RELAY` at the top of `net.js`. For local testing, run `npx wrangler dev` and open the game with `?relay=http://localhost:8787`.
- `game.js`: the full version (three.js rendering, keyboard and gamepad input).
- `watch.js`: the watch version (canvas rendering, touch controls).

## Run locally

```sh
python3 -m http.server
# open http://localhost:8000
```
