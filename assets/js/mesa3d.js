/* =====================================================================
   Katsuya · Mesa 3D
   Monta o pedido do cliente sobre uma mesa em 3D (three.js) e exporta
   os pratos em GLB para ver o pedido inteiro na mesa real (AR).
   Uso: const mesa = createMesa({ items, onPick }); mesa.mount(el);
        mesa.setOrder([[id, qty], ...]); await mesa.exportGLB();
   ===================================================================== */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { enhance } from "./realismo.js";
const COARSE = matchMedia("(pointer:coarse)").matches;

/* ---------------------------------------------------------------- util */
const TAU = Math.PI * 2;
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const rr = (a, b) => a + (b - a) * rnd();
const reseed = (s) => { seed = (s % 2147483646) + 1; };
const hashStr = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return Math.abs(h); };

function canvasTex(w, h, draw, { srgb = true, repeat = null } = {}) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  t.anisotropy = 4;
  return t;
}
const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0, ...o });
const lathe = (pts, segs = 48) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segs);
function mesh(geo, material, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1, sx, sy, sz } = {}) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
  m.scale.set(sx ?? s, sy ?? s, sz ?? s);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function group(...children) { const g = new THREE.Group(); children.flat().forEach((c) => c && g.add(c)); return g; }
/* desloca vértices com ruído (pedaços orgânicos: karaage, brócolis, arroz) */
function lumpy(geo, amt, sd = 1) {
  geo.deleteAttribute("normal"); geo.deleteAttribute("uv"); geo = mergeVertices(geo); // superfície lisa, sem facetas
  reseed(sd); const p = geo.attributes.position, v = new THREE.Vector3(), cache = new Map();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = v.x.toFixed(4) + v.y.toFixed(4) + v.z.toFixed(4);
    if (!cache.has(k)) cache.set(k, 1 + rr(-amt, amt));
    v.multiplyScalar(cache.get(k)); p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals(); return geo;
}

/* ---------------------------------------------------------- materiais */
const MAT = {};
function initMaterials() {
  MAT.ceramic = mat(0xf3f0ea, { roughness: 0.22 });
  MAT.ceramicBlack = mat(0x18181a, { roughness: 0.28 });
  MAT.ceramicRed = mat(0x9e1b1f, { roughness: 0.3 });
  MAT.slate = mat(0x232527, { roughness: 0.85 });
  MAT.rice = new THREE.MeshStandardMaterial({ roughness: 0.9, map: canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = "#f4f1ea"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${200 + rnd() * 40},${196 + rnd() * 40},${186 + rnd() * 40},.9)`;
      g.save(); g.translate(rnd() * w, rnd() * h); g.rotate(rnd() * TAU); g.beginPath(); g.ellipse(0, 0, 5, 2.4, 0, 0, TAU); g.fill(); g.restore(); }
  }) });
  MAT.salmon = new THREE.MeshStandardMaterial({ roughness: 0.35, map: canvasTex(256, 128, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, "#f2703f"); gr.addColorStop(1, "#ff8a55");
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.strokeStyle = "rgba(255,236,220,.75)"; g.lineWidth = 5;
    for (let x = -h; x < w + h; x += 26) { g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + 10, h * .35, x - 6, h * .65, x + 12, h); g.stroke(); }
  }) });
  MAT.nori = mat(0x17201a, { roughness: 0.7 });
  MAT.green = mat(0x5f9b2f, { roughness: 0.55 });
  MAT.darkGreen = mat(0x2f6b25, { roughness: 0.6 });
  MAT.chive = mat(0x4fa043, { roughness: 0.5 });
  MAT.fried = mat(0xc07a2c, { roughness: 0.75 });
  MAT.carrot = mat(0xe8742a, { roughness: 0.5 });
  MAT.meat = mat(0x7a4a32, { roughness: 0.7 });
  MAT.chashu = mat(0xc98d73, { roughness: 0.5 });
  MAT.noodle = mat(0xe9cf8a, { roughness: 0.45 });
  MAT.yakiNoodle = mat(0xb87a35, { roughness: 0.5 });
  MAT.lemon = mat(0xf2d33d, { roughness: 0.4 });
  MAT.soy = new THREE.MeshPhysicalMaterial({ color: 0x1d0d05, roughness: 0.05, clearcoat: 1 });
  MAT.lacquer = mat(0x111111, { roughness: 0.25 });
  MAT.lacquerRed = mat(0xb3181d, { roughness: 0.25 });
  MAT.bamboo = mat(0xcaa56a, { roughness: 0.6 });
  MAT.sesame = mat(0xf2ead8, { roughness: 0.6 });
  MAT.glass = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.04, transmission: 1, thickness: 0.004, ior: 1.5, transparent: true, opacity: 1 });
  MAT.ice = new THREE.MeshPhysicalMaterial({ color: 0xeef8ff, roughness: 0.15, transmission: 0.9, thickness: 0.01, transparent: true });
  MAT.tea = new THREE.MeshPhysicalMaterial({ color: 0x9fb33a, roughness: 0.1, transmission: 0.55, thickness: 0.05, transparent: true, opacity: 0.95 });
  // nomes = receitas de realismo (assets/js/realismo.js)
  [["ceramic", "ceramic"], ["ceramicBlack", "ceramic"], ["ceramicRed", "ceramic"], ["rice", "rice"], ["salmon", "salmon"], ["nori", "nori"],
   ["green", "green"], ["darkGreen", "green"], ["chive", "chive"], ["fried", "fried"], ["carrot", "green"], ["meat", "fried"], ["chashu", "chashu"],
   ["noodle", "noodle"], ["yakiNoodle", "noodle"], ["lemon", "lemon"]].forEach(([k, n]) => (MAT[k].name = n));
  MAT.mat = new THREE.MeshStandardMaterial({ roughness: 0.95, map: canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = "#1d1b19"; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 4) { g.fillStyle = `rgba(255,255,255,${0.015 + rnd() * 0.03})`; g.fillRect(0, y, w, 2); }
    g.strokeStyle = "rgba(248,178,34,.55)"; g.lineWidth = 3; g.strokeRect(14, 14, w - 28, h - 28);
  }) });
}

/* ----------------------------------------------- peças de louça base */
function plateRound(R = 0.12, m = MAT.ceramic) {
  return mesh(lathe([[0, 0.002], [R * .62, 0.002], [R * .66, 0], [R * .72, 0.001], [R * .93, 0.012], [R, 0.017], [R * .985, 0.019], [R * .92, 0.015], [R * .7, 0.007], [0, 0.007]]), m);
}
function plateRect(w = 0.26, d = 0.13, m = MAT.ceramicBlack) {
  return mesh(new RoundedBoxGeometry(w, 0.012, d, 3, 0.005), m, { y: 0.006 });
}
function bowl(R = 0.07, H = 0.06, m = MAT.ceramicBlack, inner = MAT.ceramicRed) {
  const out = mesh(lathe([[0, 0], [R * .45, 0], [R * .45, 0.006], [R * .55, 0.008], [R * .9, H * .55], [R, H]]), m);
  const inn = mesh(lathe([[R * .96, H], [R * .86, H * .55], [R * .5, 0.012], [0, 0.011]]), inner);
  m.side = inner.side = THREE.DoubleSide;
  return group(out, inn);
}
/* camada plana de comida dentro de uma tigela (caldo, arroz) */
const disc = (r, y, m) => mesh(new THREE.CircleGeometry(r, 40), m, { y, rx: -Math.PI / 2 });

/* ---------------------------------------------- pratos procedurais */
const FOOD = {
  guioza() {
    const g = group(plateRect(0.24, 0.12, MAT.ceramicBlack));
    const geo = new THREE.SphereGeometry(1, 32, 16), p = geo.attributes.position, col = [];
    for (let k = 0; k < p.count; k++) {
      const ux = p.getX(k), uy = p.getY(k), uz = p.getZ(k);
      let x = ux * 0.036, y = uy * 0.02, z = uz * 0.016;
      y = Math.max(y, -0.003) + 0.003;                    // base achatada (selada na chapa)
      z += 7 * x * x - 0.004;                             // meia-lua
      if (uy > 0.6) y += 0.0022 * Math.max(0, Math.sin(ux * 22)); // pregas no topo
      p.setXYZ(k, x, y, z);
      const c = new THREE.Color(0xf1e2c0);
      // servido com o lado selado na chapa para cima (dourado e tostado no topo)
      const sear = Math.min(1, Math.max(0, (uy - 0.25) * 1.8)) * (0.75 + 0.25 * Math.sin(ux * 31 + uz * 17));
      c.lerp(new THREE.Color(0xd9a35a), Math.min(1, Math.max(0, (uy + 0.1) * 1.4)) * 0.5).lerp(new THREE.Color(0x8a4a12), sear);
      col.push(c.r, c.g, c.b);
    }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3)); geo.computeVertexNormals();
    const m = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.55, clearcoat: 0.35, clearcoatRoughness: 0.3, sheen: 0.4, sheenColor: 0xfff1d6 });
    for (let i = 0; i < 6; i++) g.add(mesh(geo, m, { x: -0.072 + i * 0.026, y: 0.012, z: -0.006, ry: Math.PI / 2 + 0.12, rz: 0.12 }));
    return g;
  },
  karaage() {
    const g = group(bowl(0.075, 0.05, MAT.ceramicBlack, MAT.ceramicBlack));
    g.add(mesh(new THREE.SphereGeometry(0.04, 20, 8, 0, TAU, 0, 1.2), MAT.darkGreen, { y: 0.014, sy: 0.35 }));
    const P = [[0, 0.04, 0], [0.03, 0.035, 0.02], [-0.03, 0.035, 0.018], [0.02, 0.034, -0.03], [-0.025, 0.033, -0.025], [0.005, 0.06, 0.004], [0.04, 0.03, -0.005]];
    P.forEach(([x, y, z], i) => g.add(mesh(lumpy(new THREE.IcosahedronGeometry(0.021, 2), 0.22, i + 3), MAT.fried, { x, y, z, sy: 0.85, ry: i })));
    const lemon = mesh(new THREE.SphereGeometry(0.02, 20, 10, 0, Math.PI), MAT.lemon, { x: 0.045, y: 0.05, z: 0.035, rz: -0.5, sx: 1.2 });
    g.add(lemon); return g;
  },
  edamame() {
    const g = group(bowl(0.068, 0.045, MAT.ceramic, MAT.ceramic));
    reseed(11);
    for (let i = 0; i < 22; i++) {
      const r = rr(0, 0.045), a = rr(0, TAU), h = 0.022 + (0.045 - r) * 0.6 + rr(0, 0.01);
      const pod = mesh(new THREE.CapsuleGeometry(0.0075, 0.04, 4, 10), MAT.green, { x: Math.cos(a) * r, y: h, z: Math.sin(a) * r, rx: rr(1.2, 1.9), ry: rr(0, TAU), rz: rr(-0.4, 0.4), sz: 0.7 });
      g.add(pod);
    }
    return g;
  },
  sunomono() {
    const g = group(bowl(0.06, 0.042, MAT.ceramicRed, MAT.ceramicBlack));
    const top = canvasTex(64, 64, (c, w) => { const gr = c.createRadialGradient(w / 2, w / 2, 2, w / 2, w / 2, w / 2);
      gr.addColorStop(0, "#e9f2c8"); gr.addColorStop(0.72, "#c9de94"); gr.addColorStop(0.82, "#2d5a22"); gr.addColorStop(1, "#1f4419"); c.fillStyle = gr; c.fillRect(0, 0, w, w); });
    const m = [mat(0x2d5a22), mat(0xffffff, { map: top, roughness: 0.35 }), mat(0xffffff, { map: top, roughness: 0.35 })];
    reseed(5);
    for (let i = 0; i < 16; i++) { const r = rr(0, 0.035), a = rr(0, TAU);
      g.add(mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.0025, 20), m, { x: Math.cos(a) * r, y: 0.03 + rr(0, 0.012), z: Math.sin(a) * r, rx: rr(-0.5, 0.5), rz: rr(-0.5, 0.5) })); }
    for (let i = 0; i < 30; i++) { const r = rr(0, 0.035), a = rr(0, TAU); g.add(mesh(new THREE.SphereGeometry(0.0014, 6, 4), MAT.sesame, { x: Math.cos(a) * r, y: 0.044, z: Math.sin(a) * r, sx: 1.6 })); }
    return g;
  },
  sashimi() {
    const g = group(plateRect(0.27, 0.14, MAT.slate));
    g.add(mesh(new THREE.SphereGeometry(0.04, 16, 6, 0, TAU, 0, 1.0), mat(0xf4f4ef, { roughness: 0.8 }), { x: -0.095, y: 0.008, sy: 0.6 })); // nabo ralado
    g.add(mesh(new THREE.CircleGeometry(0.035, 20), mat(0x3f8a2c, { side: THREE.DoubleSide, roughness: 0.5 }), { x: -0.06, y: 0.016, rx: -1.25, sx: 0.65 })); // shissô
    for (let row = 0; row < 2; row++) for (let i = 0; i < 5; i++) {
      g.add(mesh(new RoundedBoxGeometry(0.03, 0.011, 0.055, 2, 0.004), MAT.salmon, { x: -0.04 + i * 0.026, y: 0.02 + i * 0.002, z: row ? 0.03 : -0.03, rz: -0.32, ry: row ? 0.08 : -0.08 }));
    }
    g.add(mesh(lumpy(new THREE.IcosahedronGeometry(0.009, 1), 0.2, 4), mat(0x9bbf3d), { x: 0.11, y: 0.017, z: 0.045 }));
    return g;
  },
  uramaki() {
    const g = group(plateRect(0.25, 0.11, MAT.ceramic));
    const top = canvasTex(128, 128, (c, w) => {
      c.fillStyle = "#f3efe6"; c.fillRect(0, 0, w, w);
      for (let i = 0; i < 160; i++) { c.fillStyle = rnd() > .7 ? "#e2d9c4" : "#fffdf8"; c.beginPath(); c.ellipse(rnd() * w, rnd() * w, 4, 2, rnd() * 3, 0, TAU); c.fill(); }
      c.fillStyle = "#151b16"; c.beginPath(); c.arc(w / 2, w / 2, w * .3, 0, TAU); c.fill();
      c.fillStyle = "#f7f5ee"; c.beginPath(); c.arc(w / 2, w / 2, w * .27, 0, TAU); c.fill();
      c.fillStyle = "#ff7f4a"; c.beginPath(); c.ellipse(w * .44, w * .5, w * .14, w * .1, .4, 0, TAU); c.fill();
      c.fillStyle = "#fffaf0"; c.beginPath(); c.ellipse(w * .6, w * .52, w * .08, w * .11, 0, 0, TAU); c.fill();
      c.fillStyle = "#4f9b3c"; for (let i = 0; i < 9; i++) { c.beginPath(); c.arc(w * (.35 + rnd() * .3), w * (.35 + rnd() * .3), 3, 0, TAU); c.fill(); }
    });
    const side = mat(0xffffff, { map: MAT.rice.map, roughness: 0.9 }), cap = mat(0xffffff, { map: top, roughness: 0.6 });
    for (let i = 0; i < 8; i++) {
      const x = -0.1 + (i % 4) * 0.032 + (i > 3 ? 0.07 : 0), z = i > 3 ? 0.02 : -0.02;
      const roll = mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.022, 28), [side, cap, cap], { x: (i % 4) * 0.045 - 0.068, y: 0.023, z: i > 3 ? 0.026 : -0.026, ry: rr(0, 1) });
      g.add(roll);
    }
    for (let i = 0; i < 40; i++) g.add(mesh(new THREE.SphereGeometry(0.0013, 6, 4), MAT.sesame, { x: rr(-0.09, 0.09), y: 0.035, z: rr(-0.045, 0.045), sx: 1.6 }));
    return g;
  },
  temaki() {
    const g = group(plateRect(0.2, 0.1, MAT.ceramicBlack));
    const cone = group(
      mesh(new THREE.ConeGeometry(0.035, 0.13, 32, 1, true), MAT.nori, { rx: Math.PI }),
      mesh(new THREE.SphereGeometry(0.031, 20, 10, 0, TAU, 0, 1.4), MAT.rice, { y: 0.058 }),
      mesh(lumpy(new THREE.IcosahedronGeometry(0.016, 1), 0.25, 9), MAT.salmon, { y: 0.075, x: 0.008 }),
      mesh(lumpy(new THREE.IcosahedronGeometry(0.013, 1), 0.25, 10), MAT.salmon, { y: 0.07, x: -0.012, z: 0.01 }),
      mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 0.05, 6), MAT.chive, { y: 0.085, rz: 0.4, z: -0.01 }),
      mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 0.05, 6), MAT.chive, { y: 0.083, rz: -0.3, z: -0.016 })
    );
    cone.rotation.z = -1.25; cone.position.set(-0.01, 0.045, 0); g.add(cone);
    return g;
  },
  yakisoba() {
    const g = group(plateRound(0.13, MAT.ceramicBlack));
    reseed(21); const m = MAT.yakiNoodle;
    for (let i = 0; i < 46; i++) {
      const pts = []; let a = rr(0, TAU), r = rr(0, 0.07);
      for (let k = 0; k < 6; k++) { a += rr(-0.9, 0.9); r = Math.min(0.08, Math.max(0, r + rr(-0.02, 0.02))); pts.push(new THREE.Vector3(Math.cos(a) * r, 0.014 + (0.08 - r) * 0.35 + rr(0, 0.008), Math.sin(a) * r)); }
      g.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.0022, 5), m));
    }
    for (let i = 0; i < 9; i++) { const a = rr(0, TAU), r = rr(0.01, 0.06);
      g.add(mesh(new THREE.BoxGeometry(0.018, 0.003, 0.006), MAT.carrot, { x: Math.cos(a) * r, y: 0.04, z: Math.sin(a) * r, ry: rr(0, 3), rx: rr(-.4, .4) })); }
    for (let i = 0; i < 6; i++) { const a = rr(0, TAU), r = rr(0.01, 0.06);
      g.add(mesh(lumpy(new THREE.IcosahedronGeometry(0.009, 1), 0.3, 30 + i), MAT.darkGreen, { x: Math.cos(a) * r, y: 0.042, z: Math.sin(a) * r })); }
    for (let i = 0; i < 7; i++) { const a = rr(0, TAU), r = rr(0.01, 0.06);
      g.add(mesh(new RoundedBoxGeometry(0.016, 0.008, 0.012, 1, 0.003), i % 2 ? MAT.meat : mat(0xe0b884), { x: Math.cos(a) * r, y: 0.043, z: Math.sin(a) * r, ry: rr(0, 3) })); }
    return g;
  },
  salmao() {
    const g = group(plateRound(0.13, MAT.ceramic));
    const grill = new THREE.MeshStandardMaterial({ roughness: 0.4, map: canvasTex(256, 128, (c, w, h) => {
      c.fillStyle = "#e9844c"; c.fillRect(0, 0, w, h); c.fillStyle = "rgba(120,50,20,.35)"; c.fillRect(0, 0, w, h * .12);
      c.strokeStyle = "#5b2a12"; c.lineWidth = 9; for (let x = 10; x < w; x += 46) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x + 40, h); c.stroke(); }
    }) });
    g.add(mesh(new RoundedBoxGeometry(0.11, 0.028, 0.06, 3, 0.01), [MAT.salmon, MAT.salmon, grill, MAT.salmon, MAT.salmon, MAT.salmon], { x: 0.02, y: 0.022, ry: 0.3 }));
    g.add(mesh(lumpy(new THREE.SphereGeometry(0.035, 20, 10, 0, TAU, 0, 1.5), 0.04, 2), MAT.rice, { x: -0.06, y: 0.004, z: 0.02, sy: 0.9 }));
    for (let i = 0; i < 3; i++) g.add(mesh(lumpy(new THREE.IcosahedronGeometry(0.013, 1), 0.3, 40 + i), MAT.darkGreen, { x: -0.03 + i * 0.022, y: 0.016, z: -0.06 }));
    for (let i = 0; i < 4; i++) g.add(mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.003, 14), MAT.carrot, { x: 0.05 + (i % 2) * 0.018, y: 0.012, z: 0.05 + (i > 1 ? 0.016 : 0) }));
    g.add(mesh(new THREE.SphereGeometry(0.014, 16, 8, 0, Math.PI), MAT.lemon, { x: 0.075, y: 0.012, z: -0.035, rx: -Math.PI / 2, sx: 1.4 }));
    return g;
  },
  misso() {
    const g = group(bowl(0.095, 0.075, MAT.ceramicRed, MAT.ceramicBlack));
    g.add(disc(0.086, 0.062, new THREE.MeshPhysicalMaterial({ color: 0xc58a3d, roughness: 0.12, clearcoat: 0.6 })));
    reseed(8);
    for (let i = 0; i < 10; i++) { const pts = []; let a = rr(0, TAU); for (let k = 0; k < 4; k++) { a += 0.35; pts.push(new THREE.Vector3(Math.cos(a) * rr(0.02, 0.07), 0.062 + rr(0, 0.004), Math.sin(a) * rr(0.02, 0.07))); }
      g.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.0025, 5), MAT.noodle)); }
    for (let i = 0; i < 26; i++) g.add(mesh(new THREE.SphereGeometry(0.0045, 8, 6), mat(0xf5c531, { roughness: 0.35 }), { x: 0.03 + rr(-0.018, 0.018), y: 0.066, z: -0.025 + rr(-0.018, 0.018) }));
    for (let i = 0; i < 2; i++) g.add(mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.006, 24), MAT.chashu, { x: -0.03 + i * 0.012, y: 0.068 + i * 0.004, z: 0.012, rx: 0.25, rz: 0.15 }));
    for (let i = 0; i < 12; i++) g.add(mesh(new THREE.CylinderGeometry(0.0018, 0.0018, 0.035, 5), mat(0xf4f0de), { x: 0.02 + rr(-0.02, 0.02), y: 0.066, z: 0.04 + rr(-0.01, 0.01), rz: Math.PI / 2, ry: rr(0, 3) }));
    for (let i = 0; i < 14; i++) g.add(mesh(new THREE.TorusGeometry(0.004, 0.0013, 5, 10), MAT.chive, { x: rr(-0.05, 0.05), y: 0.072, z: rr(-0.05, 0.05), rx: Math.PI / 2 }));
    g.add(mesh(new THREE.BoxGeometry(0.05, 0.07, 0.002), MAT.nori, { x: -0.05, y: 0.085, z: -0.05, ry: 0.8, rx: -0.2 }));
    return g;
  },
  harumaki() {
    const g = group(plateRect(0.22, 0.11, MAT.ceramic));
    const crisp = lumpy(new THREE.CapsuleGeometry(0.015, 0.075, 6, 16), 0.06, 3);
    g.add(mesh(crisp, MAT.fried, { x: -0.03, y: 0.027, z: -0.022, rz: Math.PI / 2, ry: 0.15 }));
    g.add(mesh(crisp, MAT.fried, { x: -0.03, y: 0.027, z: 0.016, rz: Math.PI / 2, ry: -0.1 }));
    g.add(mesh(lumpy(new THREE.SphereGeometry(0.026, 24, 14), 0.05, 6), mat(0xf8efd8, { roughness: 0.55 }), { x: 0.065, y: 0.03, sy: 0.85 }));
    g.add(mesh(new THREE.CircleGeometry(0.012, 3), mat(0x3e8f37, { side: THREE.DoubleSide }), { x: 0.07, y: 0.054, rx: -1.2 }));
    for (let i = 0; i < 30; i++) g.add(mesh(new THREE.SphereGeometry(0.0012, 4, 3), mat(0x7a4519), { x: rr(-0.07, 0.01), y: 0.044, z: rr(-0.035, 0.03) }));
    return g;
  },
  mochi() {
    const g = group(plateRound(0.085, MAT.ceramicBlack));
    [[0xf4b7c3, -0.025, -0.014], [0xf6f1e4, 0.025, -0.014], [0xb9d59a, 0, 0.026]].forEach(([c, x, z], i) =>
      g.add(mesh(new THREE.SphereGeometry(0.023, 28, 16), mat(c, { roughness: 0.75 }), { x, z, y: 0.024, sy: 0.75 })));
    return g;
  },
  lata() {
    const label = canvasTex(512, 256, (c, w, h) => {
      const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, "#c8171d"); gr.addColorStop(1, "#8d0f13"); c.fillStyle = gr; c.fillRect(0, 0, w, h);
      c.fillStyle = "rgba(255,255,255,.9)"; c.font = "800 70px Inter, sans-serif"; c.textAlign = "center"; c.fillText("SODA", w * .3, h * .6); c.fillText("SODA", w * .8, h * .6);
      c.fillStyle = "#f8b222"; c.fillRect(0, h * .78, w, 10);
    });
    const can = mat(0xffffff, { map: label, metalness: 0.6, roughness: 0.3 }), alu = mat(0xd6d6d6, { metalness: 1, roughness: 0.25 });
    return group(
      mesh(new THREE.CylinderGeometry(0.033, 0.033, 0.106, 40, 1, true), can, { y: 0.061 }),
      mesh(lathe([[0, 0.114], [0.027, 0.114], [0.029, 0.118], [0.033, 0.108], [0.033, 0.114]], 40), alu),
      mesh(lathe([[0.026, 0], [0.033, 0.008], [0.033, 0.008], [0, 0.004]], 40), alu)
    );
  },
  cha() {
    const g = group(
      mesh(lathe([[0, 0], [0.03, 0], [0.034, 0.11], [0.0325, 0.11], [0.0285, 0.004], [0, 0.004]], 40), MAT.glass),
      mesh(new THREE.CylinderGeometry(0.0305, 0.028, 0.085, 32), MAT.tea, { y: 0.047 })
    );
    reseed(3); for (let i = 0; i < 4; i++) g.add(mesh(new RoundedBoxGeometry(0.018, 0.018, 0.018, 2, 0.004), MAT.ice, { x: rr(-0.01, 0.01), y: 0.075 + i * 0.008, z: rr(-0.01, 0.01), rx: rr(0, 1), ry: rr(0, 1) }));
    return g;
  },
  saque() {
    const tok = mesh(lathe([[0, 0], [0.03, 0], [0.036, 0.04], [0.032, 0.085], [0.012, 0.12], [0.011, 0.14], [0.016, 0.148], [0.012, 0.148], [0.008, 0.13], [0, 0.13]], 40), MAT.ceramic);
    const band = mesh(new THREE.CylinderGeometry(0.0362, 0.036, 0.012, 40, 1, true), mat(0x1c3f7a, { roughness: 0.3 }), { y: 0.042 });
    const cup = (x, z) => group(mesh(lathe([[0, 0], [0.015, 0], [0.024, 0.03], [0.022, 0.03], [0.012, 0.004], [0, 0.004]], 32), MAT.ceramic), disc(0.019, 0.022, mat(0xf3ead2, { roughness: 0.05 }))).translateX(x).translateZ(z);
    return group(tok, band, cup(0.065, 0.02), cup(0.055, -0.04));
  },
  generico() {
    const g = group(plateRound(0.1, MAT.ceramic));
    g.add(mesh(new THREE.SphereGeometry(0.06, 32, 12, 0, TAU, 0, Math.PI / 2), MAT.lacquerRed, { y: 0.01, sy: 0.7 }));
    g.add(mesh(new THREE.SphereGeometry(0.008, 12, 8), MAT.lacquer, { y: 0.054 }));
    return g;
  }
};
/* bebidas ficam ao lado dos jogos americanos */
const DRINKS = new Set(["lata", "cha", "saque"]);

/* --------------------------------------------------------- cenário */
function woodTexture() {
  return canvasTex(1024, 1024, (g, w, h) => {
    g.fillStyle = "#3b2416"; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y++) {
      const v = Math.sin(y * 0.045 + Math.sin(y * 0.011) * 3) * 0.5 + Math.sin(y * 0.31) * 0.12 + rr(-0.08, 0.08);
      g.fillStyle = `rgba(${v > 0 ? "120,78,46" : "18,10,6"},${Math.abs(v) * 0.38})`; g.fillRect(0, y, w, 1);
    }
    for (let i = 0; i < 70; i++) { const y = rnd() * h; g.strokeStyle = `rgba(20,10,5,${0.1 + rnd() * 0.2})`; g.lineWidth = 1 + rnd() * 2; g.beginPath(); g.moveTo(0, y);
      for (let x = 0; x <= w; x += 64) g.lineTo(x, y + Math.sin(x * 0.004 + i) * 8 + rr(-2, 2)); g.stroke(); }
    // tábuas
    g.fillStyle = "rgba(0,0,0,.55)"; [h * .25, h * .5, h * .75].forEach((y) => g.fillRect(0, y, w, 3));
  }, { repeat: [1, 1] });
}
function placeSetting() {
  const s = new THREE.Group();
  s.add(mesh(new RoundedBoxGeometry(0.38, 0.003, 0.24, 2, 0.0012), MAT.mat, { y: 0.0015 }));
  // hashioki + hashis
  s.add(mesh(new RoundedBoxGeometry(0.03, 0.01, 0.012, 2, 0.004), MAT.ceramic, { x: 0.13, y: 0.008, z: 0.075 }));
  const stick = new THREE.CylinderGeometry(0.0022, 0.0038, 0.23, 8);
  [-0.006, 0.006].forEach((dz) => {
    s.add(mesh(stick, MAT.lacquer, { x: 0.025, y: 0.012, z: 0.075 + dz, rz: Math.PI / 2 - 0.05 }));
    s.add(mesh(new THREE.CylinderGeometry(0.0039, 0.0039, 0.03, 8), MAT.lacquerRed, { x: 0.125, y: 0.016, z: 0.075 + dz, rz: Math.PI / 2 - 0.05 }));
  });
  // molheira de shoyu
  s.add(mesh(lathe([[0, 0.003], [0.03, 0.003], [0.036, 0.012], [0.034, 0.012], [0.028, 0.006], [0, 0.006]], 32), MAT.ceramic, { x: 0.13, z: -0.05 }));
  s.add(disc(0.027, 0.0075, MAT.soy).translateX(0.13).translateY(0.05));
  return s;
}
function shoyuBottle() {
  return group(
    mesh(lathe([[0, 0], [0.025, 0], [0.027, 0.07], [0.02, 0.085], [0, 0.085]], 32), new THREE.MeshPhysicalMaterial({ color: 0x2a1206, roughness: 0.05, transmission: 0.3, thickness: 0.05 })),
    mesh(lathe([[0, 0.08], [0.021, 0.08], [0.022, 0.1], [0.012, 0.11], [0.004, 0.125], [0, 0.125]], 32), MAT.lacquerRed)
  );
}

/* --------------------------------------------------------- createMesa */
export function createMesa({ items, onPick, onChange } = {}) {
  const root = document.createElement("div");
  root.className = "m3d-root";
  root.innerHTML = `<canvas class="m3d-canvas" aria-label="Mesa em 3D com os pratos do pedido"></canvas>
    <div class="m3d-tip" hidden></div><div class="m3d-load"><i></i><span>Preparando a mesa…</span></div>`;
  const canvas = root.querySelector("canvas"), tip = root.querySelector(".m3d-tip"), loadEl = root.querySelector(".m3d-load");

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, matchMedia("(pointer:coarse)").matches ? 1.6 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  initMaterials();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e0b0a);
  scene.fog = new THREE.Fog(0x0e0b0a, 2.6, 5.5);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.6;

  const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 20);
  camera.position.set(0, 1.05, 1.32);
  // sombras de contato (oclusão de ambiente) entre pratos, comida e mesa
  let composer = null;
  try {
    composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: COARSE ? 0 : 4 }));
    composer.addPass(new RenderPass(scene, camera));
    const ao = new GTAOPass(scene, camera, 1, 1);
    ao.blendIntensity = 1;
    ao.updateGtaoMaterial({ radius: 0.05, distanceExponent: 1.4, thickness: 0.04, scale: 1.1, samples: COARSE ? 8 : 16, distanceFallOff: 1 });
    ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, radiusExponent: 1, rings: 2, samples: COARSE ? 8 : 16 });
    composer.addPass(ao); composer.addPass(new OutputPass());
  } catch (e) { console.warn("AO desligado", e); composer = null; }
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.02, 0.02);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.enablePan = false;
  controls.minDistance = 0.55; controls.maxDistance = 2.6;
  controls.minPolarAngle = 0.15; controls.maxPolarAngle = 1.32;
  controls.autoRotate = true; controls.autoRotateSpeed = 0.35;
  controls.addEventListener("start", () => { controls.autoRotate = false; clearTimeout(idleT); });
  controls.addEventListener("end", () => { clearTimeout(idleT); idleT = setTimeout(() => (controls.autoRotate = true), 9000); });
  let idleT;

  // luzes: pendente quente sobre a mesa + preenchimento frio
  const spot = new THREE.SpotLight(0xffd6a0, 9, 0, 0.75, 0.55, 1.2);
  spot.position.set(0.15, 1.7, 0.25); spot.target.position.set(0, 0, 0);
  spot.castShadow = true; spot.shadow.mapSize.set(2048, 2048); spot.shadow.bias = -0.00012; spot.shadow.normalBias = 0.01; spot.shadow.radius = 4;
  spot.shadow.camera.near = 0.5; spot.shadow.camera.far = 3;
  scene.add(spot, spot.target);
  scene.add(new THREE.HemisphereLight(0xffe8d0, 0x1a0e08, 0.35));
  const rim = new THREE.DirectionalLight(0x9fb7ff, 0.5); rim.position.set(-1.5, 1, -1.5); scene.add(rim);

  // mesa
  const TW = 1.8, TD = 1.1;
  const wood = woodTexture();
  const table = mesh(new RoundedBoxGeometry(TW, 0.05, TD, 4, 0.012), new THREE.MeshPhysicalMaterial({ map: wood, roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.35 }), { y: -0.025 });
  table.castShadow = false; scene.add(table);
  const legM = mat(0x22150d, { roughness: 0.5 });
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b]) => scene.add(mesh(new THREE.BoxGeometry(0.06, 0.72, 0.06), legM, { x: a * (TW / 2 - 0.1), y: -0.41, z: b * (TD / 2 - 0.1) })));
  const floor = mesh(new THREE.PlaneGeometry(12, 12), mat(0x161110, { roughness: 0.9 }), { y: -0.77, rx: -Math.PI / 2 });
  scene.add(floor);

  // lugares (frente e fundo)
  const SEATS = [[-0.45, 0.4, 0], [0.45, 0.4, 0], [-0.45, -0.4, Math.PI], [0.45, -0.4, Math.PI]];
  SEATS.forEach(([x, z, ry]) => { const s = placeSetting(); s.position.set(x, 0, z); s.rotation.y = ry; scene.add(s); });
  const shoyu = shoyuBottle(); shoyu.position.set(0.82, 0, 0.03); shoyu.traverse((o) => { if (o.isMesh) o.castShadow = true; }); scene.add(shoyu);

  // posições dos pratos: centro da mesa (2 fileiras) e depois sobre os jogos americanos
  const CENTER = []; [-0.17, 0.17].forEach((z) => [-0.64, -0.32, 0, 0.32, 0.64].forEach((x) => CENTER.push([x, z])));
  CENTER.sort((a, b) => Math.abs(a[0]) - Math.abs(b[0]) || b[1] - a[1]);
  const SEAT_SLOTS = SEATS.map(([x, z]) => [x - 0.03, z + (z > 0 ? -0.005 : 0.005)]);
  const DRINK_SLOTS = SEATS.map(([x, z]) => [x + (z > 0 ? 0.26 : -0.26), z + (z > 0 ? -0.06 : 0.06)]);
  const SLOTS = CENTER.concat(SEAT_SLOTS);

  const dishes = new THREE.Group(); scene.add(dishes);
  const loader = new GLTFLoader();
  const glbCache = new Map();
  function loadGLB(url) {
    if (!glbCache.has(url)) glbCache.set(url, new Promise((res, rej) => loader.load(url, (g) => {
      // as etiquetas de ingredientes (lbl_*, line) servem só no visualizador individual
      const drop = [];
      g.scene.traverse((o) => { if (o.isMesh) { if (/^(lbl_|line$)/.test(o.material?.name || "")) drop.push(o); else { o.castShadow = true; o.receiveShadow = true; } } });
      drop.forEach((o) => o.parent.remove(o));
      res(g.scene);
    }, undefined, rej)));
    return glbCache.get(url);
  }
  function buildProcedural(kind) {
    const make = FOOD[kind] || FOOD.generico; reseed(hashStr(kind));
    const g = make(); g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    enhance(g, { N: COARSE ? 512 : 1024 }); // grãos, relevo e brilho úmido
    return g;
  }
  async function buildDish(it) {
    if (it.model) { try { return (await loadGLB(it.model)).clone(true); } catch (e) { console.warn("GLB", e); } }
    return buildProcedural(it.p3d || "generico");
  }

  /* ---------- estado do pedido ---------- */
  const inst = new Map(); // chave "id#n" -> {obj, it, target, born, dying}
  let demo = true, overflow = 0;
  const DEMO_ORDER = items.filter((i) => i.model).map((i) => [i.id, 1]);

  function setOrder(lines) {
    demo = !lines.length;
    const order = demo ? DEMO_ORDER : lines;
    const wanted = [];
    order.forEach(([id, q]) => { const it = items.find((i) => i.id === id); if (it) for (let n = 0; n < q; n++) wanted.push({ key: id + "#" + n, it }); });
    // distribui posições: bebidas ao lado dos jogos americanos, o resto no centro e depois sobre os jogos
    const free = SLOTS.slice(), freeDrink = DRINK_SLOTS.slice(); overflow = 0;
    wanted.forEach((w) => {
      const isDrink = DRINKS.has(w.it.p3d);
      w.slot = (isDrink && freeDrink.shift()) || free.shift() || (isDrink ? null : freeDrink.shift()) || null;
      if (!w.slot) overflow++;
    });
    const now = performance.now();
    const keep = new Set(wanted.filter((w) => w.slot).map((w) => w.key));
    inst.forEach((v, k) => { if (!keep.has(k) && !v.dying) v.dying = now; });
    let delay = 0, pending = 0;
    for (const w of wanted) {
      if (!w.slot) continue;
      const onMat = Math.abs(w.slot[1]) > 0.3;
      const rot = (hashStr(w.key) % 100) / 100 * 0.5 - 0.25 + (w.slot[1] < -0.3 ? Math.PI : 0);
      const target = new THREE.Vector3(w.slot[0], onMat ? 0.003 : 0, w.slot[1]);
      const cur = inst.get(w.key);
      if (cur && !cur.dying) {
        if (cur.obj && !cur.obj.position.equals(target)) { cur.from = cur.obj.position.clone(); cur.moveT = now; }
        cur.target = target; cur.rot = rot; continue;
      }
      if (cur) { if (cur.obj) dishes.remove(cur.obj); inst.delete(w.key); }
      const ph = { it: w.it, target, rot, born: Infinity, obj: null, delay };
      delay += 110; pending++; inst.set(w.key, ph);
      buildDish(w.it).then((obj) => {
        if (inst.get(w.key) !== ph) return;
        obj.userData.id = w.it.id; obj.position.copy(ph.target); obj.rotation.y = ph.rot; obj.scale.setScalar(0.0001);
        ph.obj = obj; ph.born = performance.now() + ph.delay; dishes.add(obj);
        loadEl.classList.add("off"); wake();
      }).catch((e) => { console.error("prato 3D", w.it.name, e); inst.delete(w.key); });
    }
    if (!pending) loadEl.classList.add("off");
    onChange && onChange({ demo, overflow, count: wanted.length });
    wake();
  }

  /* ---------- animação ---------- */
  const easeOutBack = (t) => { const c = 1.6; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  let running = false, lastActive = 0;
  const onScreen = () => { if (document.hidden) return false; const r = root.getBoundingClientRect(); return r.width > 0 && r.bottom > 0 && r.top < innerHeight; };
  function animate(now) {
    let busy = false;
    inst.forEach((v, k) => {
      if (!v.obj) { if (v.dying) inst.delete(k); else busy = true; return; }
      const o = v.obj;
      if (v.dying) {
        const t = Math.min(1, (now - v.dying) / 260); o.scale.setScalar(Math.max(0.0001, 1 - ease(t))); o.position.y = v.target.y + t * 0.05;
        if (t >= 1) { dishes.remove(o); inst.delete(k); } else busy = true; return;
      }
      if (now < v.born) { busy = true; return; }
      const t = Math.min(1, (now - v.born) / 650);
      if (t < 1) { busy = true; o.scale.setScalar(Math.max(0.0001, Math.min(1, t * 3))); o.position.y = v.target.y + (1 - easeOutBack(t)) * 0.0 + 0.28 * Math.pow(1 - t, 2.2); o.rotation.y = v.rot + (1 - ease(t)) * 1.4; }
      else { o.scale.setScalar(1); o.rotation.y += (v.rot - o.rotation.y) * 0.2; }
      if (v.moveT) {
        const m = Math.min(1, (now - v.moveT) / 500), e = ease(m);
        o.position.x = v.from.x + (v.target.x - v.from.x) * e; o.position.z = v.from.z + (v.target.z - v.from.z) * e;
        if (m >= 1) v.moveT = 0; else busy = true;
      } else { o.position.x = v.target.x; o.position.z = v.target.z; }
      if (t >= 1) o.position.y = v.target.y;
      const hl = v.obj === hovered ? 1.04 : 1; if (t >= 1) o.scale.setScalar(o.scale.x + (hl - o.scale.x) * 0.25);
    });
    const moved = controls.update();
    if (composer) composer.render(); else renderer.render(scene, camera);
    if (busy || moved || controls.autoRotate) lastActive = now;
    if (onScreen() && (now - lastActive < 1500 || hovered)) requestAnimationFrame(animate); else running = false;
  }
  function wake() { if (!running && onScreen()) { running = true; lastActive = performance.now(); requestAnimationFrame(animate); } }
  controls.addEventListener("change", wake);

  /* ---------- tamanho / visibilidade ---------- */
  // retrato: olha a mesa pela cabeceira, para ela ocupar a altura da tela
  let lastShape = null, touched = false;
  function defaultView() {
    const a = camera.aspect;
    if (a < 0.9) { camera.fov = 40; camera.position.set(1.55, 1.45, 0.3); }
    else if (a < 1.3) { camera.fov = 40; camera.position.set(0, 1.25, 1.55); }
    else { camera.fov = 34; camera.position.set(0, 1.05, 1.32); }
    controls.target.set(0, 0.02, 0.02); camera.updateProjectionMatrix(); controls.update();
  }
  controls.addEventListener("start", () => { touched = true; });
  function resize() {
    const w = root.clientWidth, h = root.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h;
    if (composer) { composer.setPixelRatio(renderer.getPixelRatio() * (COARSE ? 0.8 : 1)); composer.setSize(w, h); }
    // enquadra a mesa inteira em telas estreitas
    const a = w / h, shape = a < 0.9 ? "tall" : a < 1.3 ? "square" : "wide";
    if (shape !== lastShape) { lastShape = shape; if (!touched) defaultView(); }
    camera.updateProjectionMatrix(); wake();
  }
  const ro = new ResizeObserver(resize); ro.observe(root);
  addEventListener("scroll", () => { if (!running) wake(); }, { passive: true });
  document.addEventListener("visibilitychange", wake);

  /* ---------- toque / clique nos pratos ---------- */
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  let hovered = null, downAt = null;
  function pick(e) {
    const r = canvas.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects(dishes.children, true)[0];
    if (!hit) return null; let o = hit.object; while (o.parent && o.parent !== dishes) o = o.parent; return o;
  }
  function showTip(o, e) {
    if (!o) { tip.hidden = true; return; }
    const it = items.find((i) => i.id === o.userData.id); const r = canvas.getBoundingClientRect();
    const q = [...inst.values()].filter((v) => v.it.id === it.id && !v.dying).length;
    tip.innerHTML = `<b>${it.name}</b>${!demo && q > 1 ? ` <span>×${q}</span>` : ""}<small>Toque para ver detalhes</small>`;
    tip.style.left = e.clientX - r.left + "px"; tip.style.top = e.clientY - r.top + "px"; tip.hidden = false;
  }
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    const o = pick(e); if (o !== hovered) { hovered = o; canvas.style.cursor = o ? "pointer" : "grab"; wake(); }
    showTip(o, e);
  });
  canvas.addEventListener("pointerleave", () => { hovered = null; tip.hidden = true; });
  canvas.addEventListener("pointerdown", (e) => { downAt = [e.clientX, e.clientY]; });
  canvas.addEventListener("pointerup", (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
    const o = pick(e); if (o && onPick) onPick(o.userData.id);
  });

  /* ---------- exportação para AR (só os pratos, centralizados) ---------- */
  async function exportGLB() {
    const out = new THREE.Group(); out.name = "Pedido Katsuya";
    inst.forEach((v) => { if (!v.obj || v.dying) return; const c = v.obj.clone(true); c.position.copy(v.target); c.rotation.y = v.rot; c.scale.setScalar(1); out.add(c); });
    const box = new THREE.Box3().setFromObject(out), ctr = box.getCenter(new THREE.Vector3());
    out.children.forEach((c) => { c.position.x -= ctr.x; c.position.z -= ctr.z; });
    const buf = await new GLTFExporter().parseAsync(out, { binary: true, maxTextureSize: 1024 });
    return new Blob([buf], { type: "model/gltf-binary" });
  }

  return {
    el: root,
    mount(container) { if (root.parentNode !== container) container.appendChild(root); resize(); },
    setOrder,
    exportGLB,
    resetView() { touched = false; defaultView(); controls.autoRotate = true; wake(); },
    view(pos, target) { controls.autoRotate = false; camera.position.set(...pos); controls.target.set(...target); controls.update(); wake(); },
    get demo() { return demo; },
    get overflow() { return overflow; }
  };
}
