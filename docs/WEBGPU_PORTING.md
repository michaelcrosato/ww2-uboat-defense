# WebGPU backend — porting guide

Read this before M2–M6. It records the conventions of the existing WebGL2 renderer and exactly how
they translate to WebGPU/WGSL, so both backends produce the same image.

## 1. Coordinate conventions (most bugs come from here)

| Concept | WebGL2 backend (current) | WebGPU backend |
|---|---|---|
| Buffer pixel inside a pass | `gl_FragCoord.xy`, **y-down** because GL passes write `clip.y = by/bh*2-1` | `@builtin(position).xy` — already y-down (top-left origin) |
| Clip y from a y-down pixel `by` | `by / bh * 2.0 - 1.0` | `1.0 - by / bh * 2.0` (**flipped**) |
| Clip y for world-aligned render targets (force raster, occluder) | `v * 2.0 - 1.0` with `v = (p.y - origin.y) / size` | `1.0 - v * 2.0` (**flipped**) |
| NDC depth range | `[-1, 1]`; `worldToClip` returns `clamp(d/3000, -1, 1)` | `[0, 1]`: `clamp(d/3000, -1, 1) * 0.5 + 0.5` |
| Written depth | `gl_FragDepth = clip.z * 0.5 + 0.5` | `@builtin(frag_depth) = clip.z` (already 0..1) |
| Texel row ↔ buffer row | row r ↔ by = r | row r ↔ by = r (same, thanks to the flip) |
| Sampling world-aligned textures | `texture(t, uv)`, uv (0,0) = texel (0,0) | `textureSampleLevel(t, s, uv, 0.0)`, same uv — no flip needed |
| Present (device pixel y-down) | `uDevice.y - gl_FragCoord.y` | `position.y` directly |
| Compute cell coords | (GL uses fragment passes) | `global_invocation_id.xy` = (x, row) |

Render origin: shader world positions are relative to the snapped camera center (`Renderer.origin`).
Keep this; CPU code already folds the origin into wave phases (`Ocean.pack`) and light/hull packing.

The oblique camera (`src/gfx/camera.ts`): `bx = (x - cx) * zoom + bw/2`,
`by = ((y - cy) * cosT - z * sinT) * zoom + bh/2`, view depth `d = -((y - cy) * sinT + z * cosT)`.
`pixToWorld(bp, z)` inverts it for a known height z. Port `CAMERA_GLSL` 1:1 (with the flips above).

## 2. Resources

| GL | WebGPU |
|---|---|
| `RGBA8` target | `rgba8unorm` |
| `RGBA16F` target / sim texture | `rgba16float` (renderable, blendable, filterable, **storage**) |
| `RG16F` (wave state, velocity) | sample/render: `rg16float`; compute storage write: use `rgba16float` (rg16float is not a core storage format) |
| `R16F` (pressure, divergence, curl) | `r32float` for storage (no filtering needed: use `textureLoad`) |
| depth renderbuffer | `depth24plus` |
| float data textures (lights 4×64, hull/splat packs) | storage buffers: `var<storage, read> lights: array<LightGpu>` with vec4f fields |
| uniform arrays (`uWaveA[16]`, `uRamp[8]`, rings) | members of one uniform struct: `array<vec4f, 16>` (16-byte stride; pack vec3 colors as vec4) |
| `Program.tex(name, unit, tex)` | explicit bind group layouts; one sampler pair (nearest, linear) shared |
| ping-pong `PingPong` | two textures + two prebuilt bind groups (A→B, B→A), swap an index |

Uniform layout: WGSL `vec3` has 16-byte alignment. Use only `f32`, `vec2f`, `vec4f` in uniform
structs and write them from a `Float32Array` with documented offsets (keep a small layout table next
to each pass). Rebuild bind groups whenever a referenced texture is recreated (resize, sim size change).

## 3. GLSL → WGSL cheat sheet (constructs used in this repo)

| GLSL | WGSL |
|---|---|
| `texelFetch(t, ivec2(p), 0)` | `textureLoad(t, vec2<i32>(p), 0)` |
| `texture(t, uv)` | `textureSampleLevel(t, linearSampler, uv, 0.0)` — use the Level variant everywhere: `textureSample` is only legal in uniform control flow and our shaders sample inside branches and loops |
| `mix, clamp, smoothstep, fract, floor, step, length, normalize, dot, cross, pow, exp` | same names |
| `atan(y, x)` | `atan2(y, x)` |
| `mod(x, y)` | `fmod(x, y)` helper: `x - y * floor(x / y)` (WGSL `%` truncates toward zero) |
| `c ? a : b` | `select(b, a, c)` (**false value first**) |
| `int(x)`, `float(i)` | `i32(x)`, `f32(i)` — no implicit conversions |
| `(flags & 4) != 0` on a float flag | `(u32(flags + 0.5) & 4u) != 0u` |
| `int m[64] = int[64](...)` lookup table | `var m = array<f32, 64>(...)` inside the function (dynamic indexing of `const` arrays is not portable) |
| `layout(location = n) out vec4` (MRT) | `struct GOut { @location(0) albedo: vec4f, @location(1) normal: vec4f }` |
| `discard` | `discard` |
| `gl_VertexID` / instanced attributes | `@builtin(vertex_index)`, vertex buffers with `stepMode: 'instance'` |
| `gl_PointSize` (particles) | not available: draw particles as instanced quads (6 vertices from `vertex_index`), size in pixels → clip offset `size / bufSize * 2` |
| loops with uniform bounds + `break` | same (`for (var i = 0; i < 64; i++) { if (i >= n) { break; } ... }`) |

Keep the same chunk structure as GLSL so diffs stay readable: `CAMERA`, `DITHER`, `NOISE`, `OCEAN`,
`GBUF`, `MAT`, `QROT`, `WATER_LOOKUP`, `SIM_INPUTS`. Same function names, same constants.

## 4. Pipeline state mapping

| GL state | WebGPU |
|---|---|
| additive blend `blendFunc(ONE, ONE)` (force raster, multi-target) | `{ color: { operation: 'add', srcFactor: 'one', dstFactor: 'one' }, alpha: same }` on every target |
| occluder `blendEquationSeparate(MAX, FUNC_ADD)` | `{ color: { operation: 'max', srcFactor: 'one', dstFactor: 'one' }, alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'one' } }` (`max` requires factors `one`) |
| clear occluder to `(-50, 0, 0, 0)` | `loadOp: 'clear', clearValue: { r: -50, g: 0, b: 0, a: 0 }` (float targets accept negative clears) |
| depth `ALWAYS` for the water pass then `LESS` for stacks | two pipelines: water `depthCompare: 'always'` + `depthWriteEnabled: true`; stacks/particles `less` |
| underwater pass depth from `gl_FragDepth = dep/400` | `frag_depth = clamp(dep/400, 0, 1)` |
| triangle-strip instanced quads | `topology: 'triangle-strip'` with a 4-vertex quad buffer, or 6 vertices via `vertex_index` |

## 5. Device, canvas and fallback
- `navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })`; request
  `float32-filterable` only if present (do not require it); never require `shader-f16`.
- `context.configure({ device, format: navigator.gpu.getPreferredCanvasFormat(), alphaMode: 'opaque' })`.
  The present pass must output to that format (bgra8unorm on most platforms) — no manual swizzle needed.
- A canvas can hold only one context type. If WebGPU init fails after `getContext('webgpu')`,
  replace the canvas element before creating WebGL2 (add `Screen.replaceCanvas()`).
- Compile everything up front (`createShaderModule` + `getCompilationInfo()`; push an error scope
  around pipeline creation) so failures happen during init and trigger the fallback.
- `device.lost.then(...)` and `device.addEventListener('uncapturederror', ...)`: log, then switch to
  WebGL2 at the next frame (re-create the backend, reset sims). Never leave a black screen.
- Keep at most 2 frames in flight (`queue.onSubmittedWorkDone()` counter); skip a frame otherwise.
- Use `timestamp-query` when available for the perf overlay (M6), never required.

## 6. Headless verification
- `npm run probe:gpu` confirms the adapter. `tools/shot.mjs` already passes `--enable-unsafe-webgpu`.
- WebGPU needs a secure context: always test through the Vite server (http://localhost), never `file://`.
- Compare backends: `?renderer=webgpu` vs `?renderer=webgl2`; M6 adds a deterministic scene
  (`?scene=lookdev`) and `tools/compare.mjs` for numeric diffs.

## 7. Pass skeleton (follow this shape for every WebGPU pass)

```ts
export class WaterPassGPU {
  private pipeline: GPURenderPipeline;
  private ubo: GPUBuffer;
  private u = new Float32Array(WATER_UBO_FLOATS);      // documented offsets in WATER_UBO
  private bg: GPUBindGroup | null = null;               // rebuilt when inputs change
  constructor(private g: GpuContext) { /* createShaderModule(WGSL_COMMON + WATER_WGSL), explicit layout, pipeline */ }
  setInputs(t: { under: GPUTextureView; underD: GPUTextureView; wave: GPUTextureView; dye: GPUTextureView }) { this.bg = null; /* rebuild lazily */ }
  encode(pass: GPURenderPassEncoder, frame: FrameUniforms) {
    /* fill this.u, queue.writeBuffer(this.ubo, 0, this.u), pass.setPipeline, setBindGroup, draw(3) */
  }
}
```
One command encoder per frame; passes are recorded in the same order as `src/gfx/renderer.ts`.
