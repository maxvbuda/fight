# Neon Brawl

A 3D fighting game for up to four fighters. It runs in the browser on computers and on Apple Watch. There are no build steps and no asset files.

**Play:** https://maxvbuda.github.io/fight/

## Modes

- **On this computer:** pick 2, 3 or 4 fighters and 1 to 4 players. CPU fighters fill the empty spots: Easy, Normal, Hard, Extreme or Adaptive. Players 1 and 2 share the keyboard, and players 3 and 4 use gamepads.
- **Tricks:** special hits do bonus damage, stacking up to 2.5×, and pop up a label:
  - JUMP KICK (kick on the way up) 1.7×, also knocks them off their feet; DIVE KICK (kick on the way down) 1.9×.
  - JUMP PUNCH 1.35×, but only hits someone in the air with you: it goes over a standing fighter's head.
  - COUNTER 1.4×: hit someone while their own attack is still winding up.
  - BACK ATTACK 1.5×: hit someone facing away (easiest with 3 or 4 fighters).
  - JUGGLE 1.3×: hit someone who's been knocked into the air.
  - FINISHER 1.5×: a kick that ends a combo of 3 or more hits.
  - EDGE SLAM +6: knock someone hard into the edge of the ring.
  - PARRY: start blocking just as a hit lands (within about 0.13 s). You take nothing, and the attacker is stunned. Only the hardest CPUs parry, and only sometimes.
  - A kick from the ground passes under anyone in the air, so jump over kicks (punches still reach).
- **CPU levels:** Normal and up punish attacks you whiff, kick you out of jumps, cancel combos into their super and wait out your block. Extreme does all of that almost every time and hits harder. Adaptive saves your power (0 to 100) and starts every match at it. During a fight the CPU's live level goes up when you hurt it and down when it hurts you, so fights stay close, and it counters your habits: more anti-air if you jump a lot, more blocking and punishing if you attack a lot, more baiting if you block a lot. After every round your power moves toward how you actually played (fast at first, steadier over time), and the end screen shows the change. Power is saved in the browser (separately on the watch). The CPU's tag shows its current level.
- **Online rooms:** one player hosts and gets a 5-letter room code. Up to 3 friends join with the code from a computer or an Apple Watch, and any room can be hosted from either one. The host picks the number of fighters, and CPUs fill the empty spots. If someone leaves mid-match, they forfeit: their fighter leaves the ring for the rest of the match, and if only one fighter is left, that player wins.

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

Links: computer https://maxvbuda.github.io/fight/, phone https://maxvbuda.github.io/fight/phone, watch https://maxvbuda.github.io/fight/watch.

Open the link on the watch (for example, by sending it to yourself in Messages and tapping it). Small screens and browsers without WebGL load `/watch` (`watch.html`), which draws the same 3D fighters on a 2D canvas. The watch can fight the CPU with 2 to 4 fighters, and it can host or join online rooms.

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
- Phones get the full 3D game (`index.html` + `game.js`) with on-screen controls: a floating stick on the left half, punch/kick/jump/block/super buttons on the right. Open `/phone` (or add `?phone`) to force it. `phone.html` is an exact copy of `index.html`: keep the two identical.

## Run locally

```sh
python3 -m http.server
# open http://localhost:8000
```
