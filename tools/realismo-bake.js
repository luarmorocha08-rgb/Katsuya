/* Gera assets/models/*.glb e *.usdz com materiais realistas a partir de assets/models/src/*.glb.
   Uso: NODE_MODULES=<pasta com three@0.170.0> node tools/realismo-bake.js  (precisa de playwright) */
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, ".."), NM = process.env.NODE_MODULES || path.join(ROOT, "node_modules");
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.route("http://bake/**", (r) => {
    const u = decodeURIComponent(new URL(r.request().url()).pathname);
    const f = u.startsWith("/node_modules/") ? path.join(NM, u.slice(14)) : u === "/" ? path.join(__dirname, "realismo-bake.html") : path.join(ROOT, u);
    r.fulfill({ path: f, contentType: f.endsWith(".js") ? "application/javascript" : f.endsWith(".html") ? "text/html" : "application/octet-stream" });
  });
  p.on("console", (m) => { if (m.type() === "error") console.log(m.text()); });
  await p.goto("http://bake/"); await p.waitForFunction("window.ready");
  for (const n of ["sushi", "tonkatsu", "lamen"]) {
    const o = await p.evaluate((n) => bake(n), n);
    fs.writeFileSync(path.join(ROOT, `assets/models/${n}.glb`), Buffer.from(o.glb, "base64"));
    fs.writeFileSync(path.join(ROOT, `assets/models/${n}.usdz`), Buffer.from(o.usdz, "base64"));
    console.log(n, "ok");
  }
  await b.close();
  // texturas do USDZ em JPEG (arquivos bem menores para o iPhone)
  require("child_process").execFileSync("python3", [path.join(__dirname, "usdz-jpeg.py"), ...["sushi", "tonkatsu", "lamen"].map((n) => path.join(ROOT, `assets/models/${n}.usdz`))], { stdio: "inherit" });
})();
