// Probe whether headless Chromium exposes a working WebGPU adapter (with compute) under various flag sets.
// Usage: node tools/gpu-probe.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
const srv = createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end('<!doctype html><title>probe</title>'); }).listen(0);
const url = 'http://localhost:' + srv.address().port + '/';
const variants = [
  ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--disable-vulkan-surface', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-gl=angle', '--use-angle=vulkan', '--enable-unsafe-swiftshader'],
];
for (const args of variants) {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args });
  const p = await b.newPage();
  await p.goto(url);
  const r = await p.evaluate(async () => {
    if (!navigator.gpu) return 'no navigator.gpu';
    try {
      const a = await navigator.gpu.requestAdapter();
      if (!a) return 'no adapter';
      const d = await a.requestDevice();
      const info = a.info || {};
      // tiny compute test
      const buf = d.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      const m = d.createShaderModule({ code: '@group(0) @binding(0) var<storage, read_write> o: array<u32>; @compute @workgroup_size(1) fn main() { o[0] = 42u; }' });
      const pl = d.createComputePipeline({ layout: 'auto', compute: { module: m, entryPoint: 'main' } });
      const bg = d.createBindGroup({ layout: pl.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: buf } }] });
      const rb = d.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      const e = d.createCommandEncoder(); const c = e.beginComputePass(); c.setPipeline(pl); c.setBindGroup(0, bg); c.dispatchWorkgroups(1); c.end(); e.copyBufferToBuffer(buf, 0, rb, 0, 16); d.queue.submit([e.finish()]);
      await rb.mapAsync(GPUMapMode.READ);
      const v = new Uint32Array(rb.getMappedRange())[0];
      const feats = [...a.features].join(',');
      return `adapter ok: ${info.vendor||'?'} ${info.architecture||''} ${info.description||''} compute=${v} f16=${a.features.has('shader-f16')} float32-filterable=${a.features.has('float32-filterable')} features=[${feats}]`;
    } catch (e) { return 'error: ' + e.message; }
  });
  console.log(args.join(' '), '\n  =>', r);
  await b.close();
}
srv.close();
