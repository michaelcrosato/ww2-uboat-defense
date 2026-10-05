// Per-frame inputs shared by the GPU water sims: moving hulls (ships, subs, torpedo trails) and
// one-shot splats (explosions, shell splashes, spray impacts). Gameplay pushes them into the
// RenderScene; backends rasterize them as force instances (render/pack.ts `packForces`).

export interface HullInput {
  x: number; y: number;          // world center
  fx: number; fy: number;        // forward unit vector
  halfLen: number; halfBeam: number;
  vx: number; vy: number;        // velocity (m/s)
  angVel: number;                // yaw rate (rad/s)
  thrust: number;                // -1..1 propeller effort
  draft: number;                 // m (0 for wake-only sources)
  depth: number;                 // 0 surface; >0 = submerged depth of top (m)
  foam: number;                  // foam multiplier
  oil: number;                   // oil leak (0..1)
  fire: number;                  // burning (0..1)
  kind: number;                  // 0 ship, 1 torpedo bubble trail, 2 periscope feather, 3 sub (submerged)
}

export interface SplatInput {
  x: number; y: number; radius: number;
  wave: number;     // vertical velocity impulse (m/s) into the ripple sim (negative = crater)
  foam: number; bio: number; oil: number; fire: number;
  push: number;     // radial surface current (m/s)
}
