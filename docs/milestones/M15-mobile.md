# M15 — Mobile: fullscreen game mode, portrait 9:16, touch layout, assists

**Status:** see docs/PLAN.md · **Depends on:** M14 · **Size:** large

## Goal
Second playtest, on a phone (user): "Figure out the UI for mobile. It needs to move into a full screen game
mode where I don't go off screen or exit the browser by swiping. It needs to work in 9:16 (my favorite, not
16:9). If it's dark, give the player a silhouette or outline to see their sub. Optimize the UI: mobile is
different from desktop, two inputs, two sets of restrictions; desktop is primary. What isn't feasible on the
phone can be automated (auto attack is fine), pop-up context is fine. I like a few fixed silhouette buttons
for the non-contextual actions, with context taking their place. Temporary notifications should be
swipeable so the player can get rid of them before their timer."

## Read first
`src/ui/touch.ts`, `src/ui/hud.ts`, `src/game/player.ts`, `src/ui/shell.ts`, `src/render/screen.ts`,
`src/input/input.ts`, `src/game/tutorial.ts`.

## Acceptance
- A touch device plays missions fullscreen in the orientation it is held (portrait 9:16 first), and the back
  gesture or leaving fullscreen pauses instead of quitting.
- A separate touch layout: fixed silhouette buttons per side, context actions, pop-ups, swipeable toasts; no
  HUD element under the thumbs; desktop unchanged (reproducible desktop shots identical).
- What needs mouse precision is automated on touch (target picking, auto attack, charge depths).
- At night the player's boat is outlined.
- typecheck, `npm test`, build, WebGPU screenshots with 0 page errors, a WebGL2 smoke shot, fast-forwards.

## Notes (fill in when done)
**Done.**

A. Game mode. A mission started from a tap on a touch device (`Shell.gameMode()` from launch, tutorial,
contract, restart and Resume; also on the first touch of the overlay) asks for fullscreen without navigation
UI and locks the orientation it is held in (`Screen.enterGameMode`; refusals, e.g. iPhone Safari, which has no
element fullscreen, leave the game in the page). While a touch mission runs the shell keeps a history entry
of its own: the system back gesture lands on it, the shell pushes it again and pauses (or closes the open
menu). Dropping out of fullscreen pauses too; Resume goes back in. `overscroll-behavior: none`, no touch
callout and no tap highlight stop pull-to-refresh and long-press menus. A web app manifest (`display:
fullscreen`, any orientation) and home-screen icons (`tools/icons.mjs`, the favicon's pixel U-boat enlarged
by whole pixels) make "Add to Home Screen" start chrome-less, which is the only fullscreen iOS offers.
Setting: `controls.autoFullscreen` (on). The M14 "turn sideways" notice (and `App.held`) is gone.

B. Portrait first. `display.pixelScale` auto now divides the **short** side by `display.targetHeight`, so a
9:16 phone gets the same game pixel as landscape (a 412×915 phone: 361×801 game pixels; desktop unchanged).
On touch the HUD pixel rounds down where the game pixel rounded up (`Screen.setTouchHud`: a 4:3 tablet's HUD
went 472×328 → 590×410), so the HUD keeps at least the target on its short side.
Touch HUD (`Hud.mobile`, set by the overlay): the vessel status sits under the objectives at the top (the
bottom of the screen belongs to the thumbs); the plot shrinks to R 40 on a narrow HUD; the compass fits in
the room between the objectives and the plot; crew messages and warnings become DOM toasts; the FPS moves
under the plot; no "TIME x" text (the time button shows it). `Hud.layout` publishes the columns' bottom and
inner edges each frame and `Hud.reserved` takes the overlay's DOM controls (pause / time buttons, throttle):
the tutorial panel goes between the top columns when ≥ 200 HUD px fit there, else under both, clear of the
pause / time buttons and beside the throttle. Pause and time compression sit under the plot in portrait and
beside it in landscape (the right-thumb cluster needs the height). Checked at 412×915, 360×640, 915×412,
640×360, 1180×820 and 820×1180 (`check-output/m15/`).

C. Touch controls (`src/ui/touch.ts`, rewritten; `controls.touch` auto shows them on a touch device).
- Left thumb: a course stick (appears where the thumb lands in the lower left; points the course, which holds
  when the thumb lifts) and above it a throttle with the seven telegraph rungs.
- Right thumb: four fixed silhouette buttons (`src/ui/icons.ts`, inline SVG). U-boat: FIRE (tubes loaded),
  DEPTH (names its next move: DIVE on the surface, else the order; pop-up with surface / periscope / 40 m /
  under the layer / deep), SCOPE or GUN (deck gun on the surface, periscope below), ★ abilities (ready count).
  Escort: D/C (charges left; a salvo from the rails and both throwers at the set depth, with an `AUTO`-or-fixed
  charge-depth chip and pop-up), PING, GUNS AUTO / HOLD FIRE, ★. The ability pop-up is a 3×2 grid of the six slots.
- A context button above the cluster (beside it in landscape) when one action matters (`Assist.context`):
  CRASH DIVE / GO DEEP when hunted near the surface, FIRE SPREAD with a solution inside 1.6 km, SURFACE on a
  flat battery with no escort near; escort: HEDGEHOG when it bears 140–300 m, DROP PATTERN over the contact,
  STAR SHELL / SEARCHLIGHT at night.
- The sea: tap a ship to lock it (open water: let go and aim there), drag to aim, pinch to zoom. The camera
  leads toward the locked target or ahead of the bow (a tapped aim point stays put and pulled the view off).
- Top right: time compression (cycles to `game.maxCompression`) and MENU.

D. Automation (`src/game/assist.ts`, `controls.autoAttack`: touch only by default, or always / off). FIRE
locks the best target when none is (nearest merchant the torpedoes can reach, escorts weighted 1.6×), aims
and fires one torpedo along the TDC solution, or says why not; escort guns engage a visible surfaced U-boat in
range by themselves (locked first); the U-boat deck gun fires at the locked or hovered target; the ASDIC pings
the freshest contact inside 1.15× its range every 3 s; PING trains on the contact or sweeps the bow in 20°
steps; charge depths follow the plot (the set's depth reading from 1944, else 30 m growing 0.5 m/s since
first contact). Verified in fast-forwards: the guns opened fire on a surfaced U-boat by themselves, a dived
contact drew 4 auto pings and no shots, FIRE locked a target and launched along the solution, a tap locked
the ship under it.

E. Notifications (`src/ui/toasts.ts`). Warnings first, then the newest crew messages (4 in portrait, 3 on a
short landscape screen), in a column under the top panels (portrait: full width under the pause buttons;
landscape: between the columns). A sideways or upward swipe flies a toast off; a swiped warning stays quiet
for 20 s even if its condition persists (`Hud.dismissWarning`), a swiped message is marked `gone`. Desktop
keeps the canvas messages.

F. Night outline (`display.nightOutline`: after dark (default) / always / off). The player's hull plan is
traced faintly at the waterline from darkness 0.3, fully at 0.65, dashed while submerged; both sides, both
platforms (the dark-hull-on-dark-water problem is the same on desktop; it is the only change in desktop shots).

G. Small things: the footer key hints are hidden on touch (also before the first touch on a hover-less
device); the tutorial speaks touch (stick, throttle, button names, [★] abilities, no helm step); the lesson
picker's card titles fit a phone; `tools/shot.mjs --mobile [--dpr]` emulates a phone (touch events, coarse
pointer, isMobile viewport) with `tap`, `swipe`, `hold` and `pinch` steps sent as CDP touch events.

H. Verification: typecheck, `npm test` (17 pass), `npm run build`; WebGPU (`gpupresent=readback`) portrait
night shot (outline, 0 page errors); WebGL2 shots at six phone/tablet sizes for both sides, tutorial, title,
picker, pop-ups, toasts and the context button (0 page errors); live touch runs: throttle tap → FULL, depth
pop-up → periscope depth, stick + pinch, tap-to-lock, swipe dismissal. Desktop regression against M14:
the reproducible day shot is byte-identical, 150 s fast-forwards of both sides give identical logs; the night
shot differs only by the outline (606 px around the boat).

I. Follow-ups: nothing was tried on a real phone or tablet (Chromium mobile emulation + CDP touch only); iOS
Safari has no element fullscreen or orientation lock (Add to Home Screen is the way) and its edge-swipe back
is untested; the assists are untuned by playtests (auto guns and auto pings make the escort side easier on
touch); `controls.touch` auto also shows the touch layout on touch-screen laptops.
