# Neon Brawl

A 3D fighting game that runs in the browser, built with [three.js](https://threejs.org). There are no build steps and no asset files.

**Play:** https://maxvbuda.github.io/fight/

## Modes

- **Fight the CPU**: Easy, Normal, or Hard.
- **2 players, one keyboard**: local versus.
- **Online**: one player hosts and gets a 5-letter room code, and the other player enters it to join. Connections are peer-to-peer over WebRTC ([PeerJS](https://peerjs.com)). The host runs the simulation, and the guest sends inputs and renders the host's state.

## Controls

| Action | Player 1 / solo / online | Player 2 (local) | Gamepad |
|---|---|---|---|
| Move | A / D | ← / → | Left stick |
| Sidestep | W / S | ↑ / ↓ | Left stick |
| Jump | Space | Right Shift / Num 0 | A |
| Punch | J or F | , / Num 1 | X |
| Kick | K or G | . / Num 2 | Y |
| Block (hold) | L or H | / / Num 3 | RB |
| Super (full meter) | U or R | ; / Num 4 | B |

After you land a hit, press punch or kick again to chain a combo. Damage dealt and damage taken both fill the super meter. Matches are best of three rounds, and each round lasts 99 seconds.

## Run locally

```sh
python3 -m http.server
# open http://localhost:8000
```
