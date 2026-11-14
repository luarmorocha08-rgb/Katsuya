"""Gera dist-artifact/: mesma página, com os .glb embalados em .js
(o host de artifacts do claude.ai não serve arquivos .glb)."""
import base64, pathlib, re, shutil
root = pathlib.Path(__file__).resolve().parent.parent
out = root / "dist-artifact"
shutil.rmtree(out, ignore_errors=True)
shutil.copytree(root / "assets", out / "assets", ignore=shutil.ignore_patterns("*.glb"))
html = (root / "index.html").read_text()
tags = []
for glb in sorted((root / "assets/models").glob("*.glb")):
    name = glb.stem
    b64 = base64.b64encode(glb.read_bytes()).decode()
    (out / f"assets/models/{name}.js").write_text(
        f'(window.KATSUYA_GLB=window.KATSUYA_GLB||{{}}).{name}=URL.createObjectURL(new Blob([Uint8Array.from(atob("{b64}"),c=>c.charCodeAt(0))],{{type:"model/gltf-binary"}}));\n')
    html = html.replace(f'const GLB_{name}="assets/models/{name}.glb";', f'const GLB_{name}=window.KATSUYA_GLB.{name};')
    tags.append(f'<script src="assets/models/{name}.js"></script>')
html = html.replace("<script>\n/* ===================== DADOS", "\n".join(tags) + "\n<script>\n/* ===================== DADOS", 1)
(out / "index.html").write_text(html)
print("ok", out)
