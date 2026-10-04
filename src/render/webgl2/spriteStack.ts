// Sprite-stack renderer. Each voxel slice is an instanced quad transformed by the body's full
// rigid transform (position + quaternion) and projected by the oblique camera. Three programs:
//  * gbuf     : parts above the local water surface -> albedo/normal G-buffer (waterline foam)
//  * under    : parts below the surface -> submerged color + depth below surface
//  * occluder : top-down orthographic -> heightmap of occluders for the shadow pass

import { InstanceBatch, makeTex, Program, type GL } from './gl';
import { CAMERA_GLSL, DITHER_GLSL, GBUF_OUT_GLSL, MAT_GLSL, NOISE_GLSL } from './glsl/common';
import { OCEAN_GLSL } from './glsl/ocean';
import type { SliceAtlas } from '../../art/voxel';

const QROT_GLSL = /* glsl */ `
vec3 qrot(vec4 q, vec3 v) { vec3 t = 2.0 * cross(q.xyz, v); return v + q.w * t + cross(q.xyz, t); }
`;

const VS = /* glsl */ `#version 300 es
precision highp float;
${CAMERA_GLSL}
${QROT_GLSL}
layout(location = 0) in vec2 aQuad;
layout(location = 1) in vec4 iPos;    // body position (rel origin), slice local z
layout(location = 2) in vec4 iRot;    // quaternion
layout(location = 3) in vec4 iRect;   // slice x0, y0, w, h (model meters)
layout(location = 4) in vec4 iUv;     // atlas rect
layout(location = 5) in vec4 iMisc;   // damage, flags, clip x0, clip x1
uniform int uOccluder;
uniform vec4 uOccRect;
out vec2 vUv;
out vec3 vWorld;
out vec3 vLocal;
flat out vec4 vRot;
flat out vec4 vMisc;
void main() {
  vec3 local = vec3(iRect.x + aQuad.x * iRect.z, iRect.y + aQuad.y * iRect.w, iPos.w);
  if ((int(iMisc.y + 0.5) & 8) != 0) local.z = 0.0;   // flatten (ground shadows)
  vec3 w = iPos.xyz + qrot(iRot, local);
  vWorld = w; vLocal = local; vRot = iRot; vMisc = iMisc;
  vUv = mix(iUv.xy, iUv.zw, aQuad);
  if (uOccluder == 1) {
    vec2 c = (w.xy - uOccRect.xy) / uOccRect.zw * 2.0 - 1.0;
    gl_Position = vec4(c, 0.0, 1.0);
  } else {
    gl_Position = worldToClip(w);
  }
}`;

const WATER_LOOKUP_GLSL = /* glsl */ `
uniform sampler2D uWave;
uniform vec4 uSimRect;
uniform int uSimOn;
uniform float uRippleScale;
float waterAt(vec2 p) {
  float h = oceanHeight(p);
  if (uSimOn == 1) {
    vec2 uv = (p - uSimRect.xy) / uSimRect.zw;
    vec2 e = min(uv, 1.0 - uv);
    float w = smoothstep(0.0, 0.06, min(e.x, e.y));
    if (w > 0.0) h += texture(uWave, uv).r * w * uRippleScale;
  }
  return h;
}
`;

const GBUF_FS = /* glsl */ `#version 300 es
precision highp float;
${CAMERA_GLSL}
${DITHER_GLSL}
${NOISE_GLSL}
${OCEAN_GLSL}
${MAT_GLSL}
${QROT_GLSL}
${WATER_LOOKUP_GLSL}
${GBUF_OUT_GLSL}
uniform sampler2D uAtlas, uNormAtlas;
uniform vec3 uFoamCol;
uniform int uWaterline;
uniform float uTime;
in vec2 vUv; in vec3 vWorld; in vec3 vLocal;
flat in vec4 vRot; flat in vec4 vMisc;
void main() {
  if (vLocal.x < vMisc.z || vLocal.x > vMisc.w) discard;
  vec4 c = texture(uAtlas, vUv);
  if (c.a < 0.5) discard;
  vec4 nm = texture(uNormAtlas, vUv);
  int flags = int(vMisc.y + 0.5);
  if ((flags & 4) != 0) {
    // ground shadow decal: dithered darkening of the sea
    if (ditherHere() < 0.45) discard;
    oAlbedo = vec4(0.015, 0.02, 0.03, MAT_WATER / 255.0);
    oNormal = vec4(0.0, 0.0, vWorld.z, 0.0);
    return;
  }
  float wh = waterAt(vWorld.xy);
  if (vWorld.z < wh - 0.05) discard;
  vec3 n = normalize(qrot(vRot, nm.rgb * 2.0 - 1.0));
  if (n.z < 0.0) n = normalize(vec3(n.xy, 0.05));
  float mat = floor(nm.a * 255.0 + 0.5);
  vec3 alb = c.rgb;
  float emis = 0.0;
  // battle damage: scorched, blackened plating in a stable pattern
  float dmg = vMisc.x;
  if (dmg > 0.0) {
    float hsh = hash12(floor(vLocal.xy * 2.0) + floor(vLocal.z * 2.0) * 7.3);
    if (hsh < dmg * 0.6) alb *= 0.32 + 0.3 * hsh;
    else if (hsh < dmg * 0.8) alb = mix(alb, vec3(0.32, 0.17, 0.09), 0.6);
  }
  if (mat == MAT_LAMP) { emis = (flags & 1) == 1 ? 2.2 : 0.0; if (emis == 0.0) alb *= 0.5; }
  // waterline: churned white water where the hull meets the sea
  if (uWaterline == 1 && vWorld.z < wh + 0.32) {
    float d = ditherHere();
    float fz = hash12(floor(vWorld.xy * 1.5) + floor(uTime * 8.0));
    if (fz > 0.35 + d * 0.3) { alb = uFoamCol; mat = MAT_FOAM; n = vec3(0.0, 0.0, 1.0); }
    else alb *= 0.75;
  }
  // wet decks shine after green water comes over
  oAlbedo = vec4(alb, mat / 255.0);
  oNormal = vec4(n.xy, vWorld.z, emis);
}`;

const UNDER_FS = /* glsl */ `#version 300 es
precision highp float;
${CAMERA_GLSL}
${OCEAN_GLSL}
${WATER_LOOKUP_GLSL}
uniform sampler2D uAtlas;
in vec2 vUv; in vec3 vWorld; in vec3 vLocal;
flat in vec4 vRot; flat in vec4 vMisc;
layout(location = 0) out vec4 oCol;
layout(location = 1) out vec4 oDepth;
void main() {
  if (vLocal.x < vMisc.z || vLocal.x > vMisc.w) discard;
  vec4 c = texture(uAtlas, vUv);
  if (c.a < 0.5) discard;
  int flags = int(vMisc.y + 0.5);
  if ((flags & 4) != 0) discard;
  float wh = waterAt(vWorld.xy);
  float dep = wh - vWorld.z;
  if (dep < 0.0) discard;
  vec3 col = c.rgb;
  // x-ray: own submerged boat stays readable as a tinted silhouette
  if ((flags & 2) == 2) { col = mix(col, vec3(0.75, 0.95, 0.85), 0.35); dep = min(dep, 4.0); }
  oCol = vec4(col, 1.0);
  oDepth = vec4(dep, vWorld.z, 0.0, 1.0);
  gl_FragDepth = clamp(dep / 400.0, 0.0, 1.0);
}`;

const OCC_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uAtlas;
in vec2 vUv; in vec3 vWorld; in vec3 vLocal;
flat in vec4 vRot; flat in vec4 vMisc;
out vec4 o;
void main() {
  if (vLocal.x < vMisc.z || vLocal.x > vMisc.w) discard;
  vec4 c = texture(uAtlas, vUv);
  if (c.a < 0.5 || (int(vMisc.y + 0.5) & 4) != 0) discard;
  o = vec4(vWorld.z, 0.0, 0.0, 0.0);
}`;

export class SpriteStackRenderer {
  atlasTex: WebGLTexture;
  normTex: WebGLTexture;
  batch: InstanceBatch;
  pGbuf: Program; pUnder: Program; pOcc: Program;

  private texSize = 0;
  private uploaded: { atlas: SliceAtlas | null; version: number } = { atlas: null, version: 0 };

  constructor(private gl: GL) {
    this.atlasTex = makeTex(gl, 1, 1, { filter: gl.NEAREST });
    this.normTex = makeTex(gl, 1, 1, { filter: gl.NEAREST });
    this.batch = new InstanceBatch(gl, [4, 4, 4, 4, 4], 2048, 1);
    this.pGbuf = new Program(gl, 'stack.gbuf', VS, GBUF_FS);
    this.pUnder = new Program(gl, 'stack.under', VS, UNDER_FS);
    this.pOcc = new Program(gl, 'stack.occ', VS, OCC_FS);
  }

  uploadAtlas(atlas: SliceAtlas) {
    if (this.uploaded.atlas === atlas && this.uploaded.version === atlas.version) return;
    const gl = this.gl, S = atlas.size;
    if (this.texSize !== S) {
      gl.deleteTexture(this.atlasTex); gl.deleteTexture(this.normTex);
      this.atlasTex = makeTex(gl, S, S, { filter: gl.NEAREST });
      this.normTex = makeTex(gl, S, S, { filter: gl.NEAREST });
      this.texSize = S;
    }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, S, S, gl.RGBA, gl.UNSIGNED_BYTE, atlas.albedo);
    gl.bindTexture(gl.TEXTURE_2D, this.normTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, S, S, gl.RGBA, gl.UNSIGNED_BYTE, atlas.normal);
    this.uploaded = { atlas, version: atlas.version };
  }

  /** take the packed slice instances for this frame (render/pack.ts `packStacks`) */
  set(data: Float32Array, count: number) { this.batch.set(data, count); }

  draw() { this.batch.draw(); }
}
