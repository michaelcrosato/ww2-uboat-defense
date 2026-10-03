// Boot: init Rapier (WASM), WebGL2, then hand over to the app.
import RAPIER from '@dimforge/rapier3d-compat';
import { Screen } from './gfx/screen';
import { createGL } from './gfx/gl';
import { Renderer } from './gfx/renderer';
import { Camera } from './gfx/camera';
import { Ocean } from './water/ocean';
import { Environment } from './game/environment';
import { theaterById } from './game/theaters';
import { dev } from './core/devSettings';
import { destroyerArt, freighterArt, type7Art } from './art/ships';
import { quatFromEuler, quatFromYaw, qrot, DEG } from './core/math';
import { PK } from './gfx/particles';

async function boot() {
  const msg = document.getElementById('boot-msg')!;
  try {
    await RAPIER.init();
    msg.textContent = 'Starting renderer…';
    const stage = document.getElementById('stage')!;
    const screen = new Screen(stage, dev);
    const { gl, caps } = createGL(screen.canvas);
    const renderer = new Renderer(gl, caps, screen);
    const cam = new Camera();
    cam.setTilt(dev.num('camera.tilt') * DEG);
    cam.zoom = cam.targetZoom = 1.6;
    const ocean = new Ocean();
    const theater = theaterById('north_atlantic');
    ocean.setSea({ seaState: 4, windDir: 0.4, swellHeight: 1.6, swellDir: 0.9, swellLength: 160, count: 12, choppiness: 0.6 });
    const env = new Environment();
    env.setTheater(theater);
    env.apply({ hour: 23, moonPhase: 0.5, weather: 'clear' });
    const dd = destroyerArt(), fr = freighterArt(0), ub = type7Art();
    const ddM = renderer.atlas.add(dd.hull), frM = renderer.atlas.add(fr.hull), ubM = renderer.atlas.add(ub.hull);
    const mounts = dd.mounts.map((mt) => ({ mt, model: renderer.atlas.add(mt.model) }));
    const ubMounts = ub.mounts.map((mt) => ({ mt, model: renderer.atlas.add(mt.model) }));
    (window as any).__dbg = { renderer, cam, ocean, env };
    document.getElementById('boot')!.classList.add('gone');
    let t = 0, last = performance.now();
    const frame = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;
      ocean.update(dt);
      env.update(dt);
      cam.update(dt);
      const R = renderer;
      R.stacks.clear();
      R.lights.clear();
      const ddYaw = 0.3 + t * 0.02, ddX = 20 + t * 4 * Math.cos(ddYaw), ddY = 10 + t * 4 * Math.sin(ddYaw);
      const roll = Math.sin(t * 0.9) * 4 * DEG, pitch = Math.sin(t * 0.6) * 1.5 * DEG;
      const qd = quatFromEuler(roll, pitch, ddYaw);
      R.stacks.add({ model: ddM, x: ddX, y: ddY, z: ocean.height(ddX, ddY) * 0.8, q: qd });
      for (const { mt, model } of mounts) {
        const p = qrot(qd, mt.x, mt.y, mt.z);
        const aim = mt.id === 'searchlight' ? Math.sin(t * 0.4) * 1.2 + 1.6 : mt.yaw + Math.sin(t * 0.5) * 0.6;
        const qm = quatMul(qd, quatFromYaw(aim));
        R.stacks.add({ model, x: ddX + p.x, y: ddY + p.y, z: ocean.height(ddX, ddY) * 0.8 + p.z, q: qm, flags: 1 });
        if (mt.id === 'searchlight') {
          const dir = qrot(qm, 1, 0, -0.06);
          R.lights.add({ x: ddX + p.x, y: ddY + p.y, z: p.z + 1.5, reach: 260, r: 0.95, g: 0.97, b: 1, intensity: 2.6, dx: dir.x, dy: dir.y, dz: dir.z, cosOuter: Math.cos(7 * DEG), shadow: true, beam: 1, size: 0.6 });
        }
      }
      const frX = -60, frY = -95;
      const qf = quatFromEuler(Math.sin(t * 0.5) * 2 * DEG, Math.sin(t * 0.4) * DEG, 0.05);
      R.stacks.add({ model: frM, x: frX, y: frY, z: ocean.height(frX, frY) * 0.7, q: qf, damage: 0.35 });
      const ubX = 80, ubY = 70;
      const qu = quatFromYaw(-2.3);
      R.stacks.add({ model: ubM, x: ubX, y: ubY, z: -9, q: qu });
      for (const { mt, model } of ubMounts) { const p = qrot(qu, mt.x, mt.y, mt.z); R.stacks.add({ model, x: ubX + p.x, y: ubY + p.y, z: -9 + p.z, q: qu }); }
      // a fire on the freighter
      R.lights.add({ x: frX + 20, y: frY + 2, z: 8, reach: 70, r: 1, g: 0.55, b: 0.2, intensity: 2.2 * (0.85 + 0.15 * Math.sin(t * 17)), shadow: true });
      for (let i = 0; i < 3; i++) R.particles.spawn(PK.FIRE, frX + 20 + (Math.random() - 0.5) * 4, frY + 2 + (Math.random() - 0.5) * 3, 6, 0, 0, 3, 0.8, 1.2, [1, 0.6, 0.2]);
      if (Math.random() < 0.5) R.particles.spawn(PK.SMOKE, frX + 20, frY + 2, 9, 0.5, 0, 2, 6, 2, [0.12, 0.12, 0.13]);
      R.particles.wind.x = 3; R.particles.wind.y = 1;
      R.particles.update(dt, (x, y) => ocean.height(x, y));
      const hulls = [{ x: ddX, y: ddY, fx: Math.cos(ddYaw), fy: Math.sin(ddYaw), halfLen: 49, halfBeam: 5.2, vx: 4 * Math.cos(ddYaw), vy: 4 * Math.sin(ddYaw), angVel: 0.02, thrust: 0.6, draft: 3.5, depth: 0, foam: 1, oil: 0, fire: 0, kind: 0 }];
      cam.x = ddX - 10; cam.y = ddY - 20;
      R.frame({ camera: cam, ocean, env, theater, hulls, splats: [], simDt: dt, time: t, flash: 0, flashCol: [1, 1, 1], bio: 0.3, ice: 0 });
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  } catch (e) {
    console.error(e);
    msg.innerHTML = `<div class="boot-err">${String((e as Error).message ?? e)}</div>`;
  }
}

function quatMul(a: { x: number; y: number; z: number; w: number }, b: { x: number; y: number; z: number; w: number }) {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

boot();
