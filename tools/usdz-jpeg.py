"""Converte as texturas PNG de um .usdz em JPEG (as que não têm transparência)
e regrava o pacote com o alinhamento de 64 bytes exigido pelo formato USDZ.
Uso: python3 tools/usdz-jpeg.py assets/models/*.usdz"""
import io, sys, zipfile, struct
from PIL import Image

def convert(path):
    src = zipfile.ZipFile(path)
    files, renames = [], {}
    for info in src.infolist():
        data = src.read(info.filename); name = info.filename
        if name.lower().endswith(".png"):
            im = Image.open(io.BytesIO(data))
            if im.mode in ("RGBA", "LA") and im.getchannel("A").getextrema()[0] < 255:
                pass  # tem transparência (etiquetas): mantém PNG
            else:
                buf = io.BytesIO(); im.convert("RGB").save(buf, "JPEG", quality=88, optimize=True)
                new = name[:-4] + ".jpg"; renames[name.split("/")[-1]] = new.split("/")[-1]; name, data = new, buf.getvalue()
        files.append([name, data])
    for f in files:
        if f[0].endswith((".usda", ".usd")):
            t = f[1].decode("utf-8")
            for a, b in renames.items(): t = t.replace(a, b)
            f[1] = t.encode("utf-8")
    out = io.BytesIO(); z = zipfile.ZipFile(out, "w", zipfile.ZIP_STORED)
    for name, data in files:  # .usda precisa ser o primeiro arquivo
        zi = zipfile.ZipInfo(name, (2024, 1, 1, 0, 0, 0)); zi.compress_type = zipfile.ZIP_STORED
        header = 30 + len(name.encode())
        pad = (64 - (out.tell() + header + 4) % 64) % 64
        zi.extra = struct.pack("<HH", 0x1986, pad) + b"\0" * pad
        z.writestr(zi, data)
    z.close()
    open(path, "wb").write(out.getvalue())
    print(path, len(out.getvalue()) // 1024, "KB", len(renames), "texturas em JPEG")

for p in sys.argv[1:]: convert(p)
