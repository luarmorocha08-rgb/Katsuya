/* =====================================================================
   Katsuya · Realismo dos pratos
   Gera, em código, texturas de detalhe por ingrediente (cor, relevo e
   brilho) e aplica nos materiais pelo nome: arroz com grãos, salmão
   úmido, empanado crocante, alga com fibras, caldo com gordura...
   Usado ao vivo na Mesa 3D e para gerar os .glb/.usdz do AR
   (tools/realismo-bake.js).
   ===================================================================== */
import * as THREE from "three";

/* ---------------------------------------------------------- ruído */
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/* ruído de valor periódico (tileável) em [0,1] */
function makeNoise(seed, period) {
  const r = mulberry(seed), P = period, g = new Float32Array(P * P);
  for (let i = 0; i < g.length; i++) g[i] = r();
  const s = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = s(x - xi), yf = s(y - yi);
    const X0 = ((xi % P) + P) % P, Y0 = ((yi % P) + P) % P, X1 = (X0 + 1) % P, Y1 = (Y0 + 1) % P;
    const a = g[Y0 * P + X0], b = g[Y0 * P + X1], c = g[Y1 * P + X0], d = g[Y1 * P + X1];
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
}
function fbm(n, x, y, oct = 4) { let v = 0, a = 0.5, f = 1, t = 0; for (let i = 0; i < oct; i++) { v += a * n(x * f, y * f); t += a; a *= 0.5; f *= 2; } return v / t; }

/* --------------------------------------------- campo de altura → textura */
class Field {
  constructor(N) { this.N = N; this.h = new Float32Array(N * N); this.col = new Float32Array(N * N * 3).fill(1); this.rough = new Float32Array(N * N).fill(0.6); }
  /* desenha um "carimbo" elíptico com perfil de cúpula, com repetição nas bordas */
  stamp(cx, cy, rx, ry, ang, height, color, rough, mode = "max") {
    const N = this.N, c = Math.cos(ang), s = Math.sin(ang), R = Math.max(rx, ry);
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const X = cx + ox * N, Y = cy + oy * N;
      if (X + R < 0 || X - R > N || Y + R < 0 || Y - R > N) continue;
      for (let y = Math.max(0, Math.floor(Y - R)); y < Math.min(N, Math.ceil(Y + R)); y++)
        for (let x = Math.max(0, Math.floor(X - R)); x < Math.min(N, Math.ceil(X + R)); x++) {
          const dx = x - X, dy = y - Y, u = (dx * c + dy * s) / rx, v = (-dx * s + dy * c) / ry, d = u * u + v * v;
          if (d >= 1) continue;
          const hh = height * Math.sqrt(1 - d), i = y * N + x;
          if (mode === "add") this.h[i] += hh; else if (hh <= this.h[i]) continue; else this.h[i] = hh;
          if (color) { const k = 0.75 + 0.25 * Math.sqrt(1 - d); this.col[i * 3] = color[0] * k; this.col[i * 3 + 1] = color[1] * k; this.col[i * 3 + 2] = color[2] * k; }
          if (rough != null) this.rough[i] = rough;
        }
    }
  }
  each(fn) { const N = this.N; for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) fn(x, y, y * N + x); }
  toTextures(normalStrength, { color = true } = {}) {
    const N = this.N, h = this.h;
    const mk = () => { const c = document.createElement("canvas"); c.width = c.height = N; return c; };
    const cN = mk(), gN = cN.getContext("2d"), dN = gN.createImageData(N, N);
    const cR = mk(), gR = cR.getContext("2d"), dR = gR.createImageData(N, N);
    const cC = color ? mk() : null, gC = cC && cC.getContext("2d"), dC = gC && gC.createImageData(N, N);
    const H = (x, y) => h[((y + N) % N) * N + ((x + N) % N)];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x, o = i * 4;
      const dx = (H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1) - H(x - 1, y - 1) - 2 * H(x - 1, y) - H(x - 1, y + 1)) * normalStrength;
      const dy = (H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1) - H(x - 1, y - 1) - 2 * H(x, y - 1) - H(x + 1, y - 1)) * normalStrength;
      const l = Math.hypot(dx, dy, 1);
      dN.data[o] = (-dx / l * 0.5 + 0.5) * 255; dN.data[o + 1] = (dy / l * 0.5 + 0.5) * 255; dN.data[o + 2] = (1 / l * 0.5 + 0.5) * 255; dN.data[o + 3] = 255;
      const r = Math.min(1, Math.max(0.02, this.rough[i])) * 255; dR.data[o] = 255; dR.data[o + 1] = r; dR.data[o + 2] = 0; dR.data[o + 3] = 255; // G = rugosidade (glTF)
      if (dC) { for (let k = 0; k < 3; k++) dC.data[o + k] = Math.min(255, Math.max(0, Math.pow(this.col[i * 3 + k], 1 / 2.2) * 255)); dC.data[o + 3] = 255; }
    }
    gN.putImageData(dN, 0, 0); gR.putImageData(dR, 0, 0); if (gC) gC.putImageData(dC, 0, 0);
    const tex = (c, srgb) => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.userData.mimeType = "image/jpeg"; return t; };
    return { normalMap: tex(cN, false), roughnessMap: tex(cR, false), map: cC ? tex(cC, true) : null };
  }
}
const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; }; // THREE.Color já é linear
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/* ----------------------------------------------------- receitas
   Cada receita recebe ppm = pixels por metro (densidade no objeto)
   e devolve o campo + parâmetros do material. Tamanhos em metros. */
const RECIPES = {
  rice(F, ppm, r) { // grãos de arroz japonês
    F.col.fill(0); for (let i = 0; i < F.N * F.N; i++) { F.col.set(lin(0xcfc8b8), i * 3); F.rough[i] = 0.9; }
    const L = 0.0056 * ppm / 2, W = 0.0026 * ppm / 2, n = Math.ceil((F.N * F.N) / (L * W * 1.1));
    for (let k = 0; k < n; k++) {
      const t = r(), c = mix(lin(0xfdfcf8), lin(0xeee9dc), t * 0.7);
      F.stamp(r() * F.N, r() * F.N, L * (0.85 + r() * 0.3), W * (0.85 + r() * 0.3), r() * Math.PI, 1 + r() * 0.4, c, 0.42 + r() * 0.2);
    }
    return { strength: 2.2 / Math.max(1, W), params: { roughness: 1, sheen: 0.4, sheenColor: 0xffffff, sheenRoughness: 0.6 } };
  },
  panko(F, ppm, r) { // farinha panko frita
    const n0 = makeNoise(7, 64);
    F.each((x, y, i) => { const v = fbm(n0, x / F.N * 64, y / F.N * 64); F.h[i] = v * 0.6; F.col.set(mix(lin(0x5a300c), lin(0x9a5a18), v), i * 3); F.rough[i] = 0.85; });
    const s = 0.0024 * ppm / 2, n = Math.ceil((F.N * F.N) / (s * s * 1.6));
    for (let k = 0; k < n; k++) {
      const t = r(), c = t < 0.15 ? lin(0xf2c779) : mix(lin(0xc9832c), lin(0xe5a649), r());
      F.stamp(r() * F.N, r() * F.N, s * (0.6 + r()), s * (0.3 + r() * 0.5), r() * Math.PI, 0.8 + r() * 1.4, c, r() < 0.2 ? 0.35 : 0.75, r() < 0.5 ? "add" : "max");
    }
    return { strength: 1.6 / Math.max(1, s * 0.6), params: { roughness: 1 } };
  },
  fish(F, ppm, r, base) { // salmão/atum: fibras + umidade
    const n0 = makeNoise(11, 128), n1 = makeNoise(5, 32);
    F.each((x, y, i) => {
      const u = x / F.N, v = y / F.N, f = Math.sin((u * 18 + fbm(n1, u * 32, v * 32) * 3) * Math.PI * 2);
      F.h[i] = 0.25 * f + 0.5 * fbm(n0, u * 128, v * 128, 3);
      F.rough[i] = 0.18 + 0.12 * fbm(n0, u * 64 + 9, v * 64, 2);
    });
    return { strength: 0.9, color: false, params: { roughness: 1, clearcoat: 0.85, clearcoatRoughness: 0.12 } };
  },
  nori(F, ppm, r) {
    const n0 = makeNoise(3, 128), n1 = makeNoise(19, 16);
    F.each((x, y, i) => {
      const u = x / F.N, v = y / F.N, fib = fbm(n0, u * 128, v * 40, 3), cr = fbm(n1, u * 16, v * 16, 3);
      F.h[i] = fib * 0.5 + cr * 0.8; F.col.set(mix(lin(0x0d150e), lin(0x253020), fib * 0.7 + cr * 0.3), i * 3); F.rough[i] = 0.35 + fib * 0.3;
    });
    return { strength: 1.4, params: { roughness: 1, sheen: 0.6, sheenColor: 0x5a7a52, sheenRoughness: 0.4 } };
  },
  wood(F, ppm, r) {
    const n0 = makeNoise(23, 32), n1 = makeNoise(29, 256);
    F.each((x, y, i) => {
      const u = x / F.N, v = y / F.N, g = Math.sin((v * 22 + fbm(n0, u * 8, v * 32) * 4) * Math.PI * 2) * 0.5 + 0.5, p = fbm(n1, u * 256, v * 24, 2);
      F.h[i] = g * 0.3 + p * 0.4; F.col.set(mix(lin(0xb98a55), lin(0xd9b17c), g * 0.6 + p * 0.4), i * 3); F.rough[i] = 0.55 + p * 0.25;
    });
    return { strength: 1.0, color: false, params: { roughness: 1, clearcoat: 0.15, clearcoatRoughness: 0.5 } };
  },
  cabbage(F, ppm, r) { // repolho fatiado fino
    for (let i = 0; i < F.N * F.N; i++) { F.col.set(lin(0x6f8f4a), i * 3); F.rough[i] = 0.7; }
    const w = 0.0011 * ppm, n = Math.ceil(F.N * F.N / (w * w * 18));
    for (let k = 0; k < n; k++) { const c = mix(lin(0xf3f6df), lin(0xb8d68a), r()); F.stamp(r() * F.N, r() * F.N, w * (6 + r() * 8), w * (0.7 + r() * 0.5), r() * Math.PI, 1, c, 0.35 + r() * 0.2); }
    return { strength: 1.2 / Math.max(1, w * 0.5), params: { roughness: 1, clearcoat: 0.3, clearcoatRoughness: 0.3 } };
  },
  noodle(F, ppm, r) {
    const n0 = makeNoise(31, 64);
    F.each((x, y, i) => { const u = x / F.N, v = y / F.N; F.h[i] = fbm(n0, u * 64, v * 8, 3); F.rough[i] = 0.32 + 0.15 * F.h[i]; });
    return { strength: 0.6, color: false, params: { roughness: 1, clearcoat: 0.5, clearcoatRoughness: 0.25 } };
  },
  broth(F, ppm, r) { // caldo com gotas de gordura
    const n0 = makeNoise(37, 32);
    F.each((x, y, i) => { F.h[i] = fbm(n0, x / F.N * 32, y / F.N * 32, 3) * 0.15; F.rough[i] = 0.06; });
    const s = 0.003 * ppm;
    for (let k = 0; k < 900; k++) { const rr = s * (0.2 + Math.pow(r(), 3) * 1.4); F.stamp(r() * F.N, r() * F.N, rr, rr, 0, 0.6, null, 0.02); }
    return { strength: 0.8, color: false, params: { roughness: 1, clearcoat: 1, clearcoatRoughness: 0.03 } };
  },
  glaze(F, ppm, r) { // chashu, ovo marinado: brilho de laqueado
    const n0 = makeNoise(41, 64);
    F.each((x, y, i) => { const v = fbm(n0, x / F.N * 64, y / F.N * 64, 4); F.h[i] = v; F.rough[i] = 0.3 + v * 0.25; });
    return { strength: 0.8, color: false, params: { roughness: 1, clearcoat: 0.6, clearcoatRoughness: 0.2 } };
  },
  pork(F, ppm, r) { // corte do lombo: fibras
    const n0 = makeNoise(43, 128), n1 = makeNoise(47, 16);
    F.each((x, y, i) => {
      const u = x / F.N, v = y / F.N, f = fbm(n0, u * 24, v * 128, 3), m = fbm(n1, u * 16, v * 16, 2);
      F.h[i] = f; F.col.set(mix(lin(0xe9b39a), lin(0xf6d8c4), f * 0.6 + m * 0.4), i * 3); F.rough[i] = 0.5 + f * 0.2;
    });
    return { strength: 0.6, params: { roughness: 1, clearcoat: 0.25, clearcoatRoughness: 0.35 } };
  },
  ceramic(F, ppm, r) { // esmalte da louça: leves ondulações
    const n0 = makeNoise(53, 16);
    F.each((x, y, i) => { F.h[i] = fbm(n0, x / F.N * 16, y / F.N * 16, 3) * 0.25; F.rough[i] = 0.12; });
    return { strength: 0.6, color: false, params: { roughness: 1, clearcoat: 0.9, clearcoatRoughness: 0.08 } };
  },
  citrus(F, ppm, r) { // casca de limão: poros
    const n0 = makeNoise(59, 128);
    F.each((x, y, i) => { F.h[i] = 1 - Math.pow(fbm(n0, x / F.N * 128, y / F.N * 128, 2), 2); F.rough[i] = 0.35; });
    return { strength: 1.0, color: false, params: { roughness: 1, clearcoat: 0.5, clearcoatRoughness: 0.25 } };
  },
  grated(F, ppm, r) { // wasabi ralado
    const n0 = makeNoise(61, 64);
    F.each((x, y, i) => { const v = fbm(n0, x / F.N * 64, y / F.N * 64, 4); F.h[i] = v; F.col.set(mix(lin(0x6f8f22), lin(0xa9c45a), v), i * 3); F.rough[i] = 0.6; });
    return { strength: 2.0, params: { roughness: 1, clearcoat: 0.3, clearcoatRoughness: 0.4 } };
  },
  wet(F, ppm, r) { // gengibre, folha, cebolinha: superfície úmida
    const n0 = makeNoise(67, 32);
    F.each((x, y, i) => { F.h[i] = fbm(n0, x / F.N * 32, y / F.N * 32, 3) * 0.4; F.rough[i] = 0.3; });
    return { strength: 0.6, color: false, params: { roughness: 1, clearcoat: 0.6, clearcoatRoughness: 0.15 } };
  },
  fried(F, ppm, r) { // karaage, guioza selado, harumaki
    const n0 = makeNoise(71, 64), n1 = makeNoise(73, 256);
    F.each((x, y, i) => { const v = fbm(n0, x / F.N * 64, y / F.N * 64, 4), w = fbm(n1, x / F.N * 256, y / F.N * 256, 2); F.h[i] = v * 0.7 + w * 0.5; F.rough[i] = 0.45 + w * 0.4; });
    return { strength: 2.4, color: false, params: { roughness: 1, clearcoat: 0.35, clearcoatRoughness: 0.3 } };
  }
};

/* nome do material → receita */
const BY_NAME = {
  rice: "rice", panko: "panko", salmon: "fish", tuna: "fish", nori: "nori", wood: "wood", cabbage: "cabbage", noodle: "noodle",
  broth: "broth", chashu: "glaze", eggw: "glaze", eggtop: "glaze", pork: "pork", plate: "ceramic", bowlblack: "ceramic",
  bowl_out: "ceramic", bowl_in: "ceramic", lemon: "citrus", wasabi: "grated", gari: "wet", leaf: "wet", scallion: "wet",
  sauce: "sauce", sesame: "wet", naruto: "glaze", rolltop: "rice", ceramic: "ceramic", fried: "fried", chive: "wet", green: "wet"
};

const cache = new Map();
function texturesFor(recipe, ppm, N, seed = 1) {
  const bucket = Math.round(Math.log2(Math.max(1, ppm)) * 2); // ~41% de passo
  const key = recipe + ":" + bucket + ":" + N;
  if (cache.has(key)) return cache.get(key);
  const F = new Field(N), r = mulberry(seed * 977 + bucket);
  const out = RECIPES[recipe](F, Math.pow(2, bucket / 2), r);
  const tex = F.toTextures(out.strength, { color: out.color !== false });
  const res = { ...tex, params: out.params };
  cache.set(key, res);
  return res;
}

/* pixels por metro que a textura terá neste objeto (pela extensão das UVs) */
function texelDensity(mesh, N) {
  const g = mesh.geometry, uv = g.attributes.uv; if (!uv) return null;
  g.computeBoundingBox(); const s = new THREE.Vector3(); g.boundingBox.getSize(s); s.multiply(mesh.getWorldScale(new THREE.Vector3()));
  let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
  for (let i = 0; i < uv.count; i++) { const u = uv.getX(i), v = uv.getY(i); if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; }
  if (Math.min(u1 - u0, v1 - v0) < 0.04) return null; // UVs achatadas: detalhe sairia riscado
  const uvSpan = Math.max(u1 - u0, v1 - v0, 1e-4), world = Math.max(s.x, s.y, s.z, 1e-4);
  return { ppm: (N * uvSpan) / world };
}

/* receitas que redesenham a cor: ganham UVs novas (projeção de caixa) com escala real */
const TILE = { rice: 0.12, panko: 0.1, cabbage: 0.1, nori: 0.09, pork: 0.08, grated: 0.04 };
function boxUV(mesh, tile) {
  const g = mesh.geometry = mesh.geometry.clone(), p = g.attributes.position;
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i)), x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let u, v; if (ay >= ax && ay >= az) { u = x; v = z; } else if (ax >= az) { u = z; v = y; } else { u = x; v = y; }
    uv[i * 2] = u / tile; uv[i * 2 + 1] = v / tile;
  }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

/* troca o material por um MeshPhysicalMaterial com detalhe realista */
const BIG = new Set(["rice", "panko", "fish", "broth"]);
export function realMaterial(mesh, recipe, { N: Nmax = 1024 } = {}) {
  const N = BIG.has(recipe) ? Nmax : Math.min(512, Nmax);
  const old = mesh.material;
  if (!old || Array.isArray(old)) return;
  const p = new THREE.MeshPhysicalMaterial();
  THREE.MeshStandardMaterial.prototype.copy.call(p, old);
  p.name = old.name; p.side = old.side; p.vertexColors = old.vertexColors;
  if (recipe === "sauce") { Object.assign(p, { roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.02 }); mesh.material = p; return p; }
  const keepArt = old.map && (recipe === "rice" && old.name === "rolltop");
  let d;
  if (TILE[recipe] && !keepArt) { boxUV(mesh, TILE[recipe]); d = { ppm: N / TILE[recipe] }; }
  else d = texelDensity(mesh, N);
  if (!d || !RECIPES[recipe]) { Object.assign(p, { clearcoat: 0.3, clearcoatRoughness: 0.3 }); mesh.material = p; return p; }
  const t = texturesFor(recipe, d.ppm, N);
  p.normalMap = t.normalMap; p.normalScale = new THREE.Vector2(1, 1);
  p.roughnessMap = t.roughnessMap;
  // a cor procedural só entra quando o material não tinha arte própria (ou é arroz/panko, que redesenhamos)
  if (t.map && TILE[recipe] && !keepArt) { p.map = t.map; p.color.set(0xffffff); }
  const { sheenColor, ...rest } = t.params;
  Object.assign(p, rest);
  if (sheenColor != null) p.sheenColor = new THREE.Color(sheenColor);
  mesh.material = p;
  return p;
}

/* aplica em toda a hierarquia, pelo nome de cada material */
export function enhance(root, opts = {}) {
  const seen = new Map();
  root.traverse((o) => {
    if (!o.isMesh || !o.material || Array.isArray(o.material)) return;
    const name = (o.material.name || "").toLowerCase();
    if (/^(lbl_|line$)/.test(name)) return;
    const recipe = BY_NAME[name]; if (!recipe) return;
    if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    if (o.geometry.boundingSphere.radius * Math.max(o.scale.x, o.scale.y, o.scale.z) < 0.006) return; // peças minúsculas

    const key = o.material.uuid + ":" + o.geometry.uuid;
    if (seen.has(key)) { o.material = seen.get(key); return; }
    const m = realMaterial(o, recipe, opts); if (m) seen.set(key, m);
  });
  return root;
}
