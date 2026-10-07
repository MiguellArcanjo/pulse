"""Gera o ícone do HackerBot (PNG 256 px + ICO) sem dependências externas.

Quadrado arredondado com degradê azul → roxo (cores do mockup) e um hexágono branco
vazado no centro. Rode: python apps/desktop/scripts/make-icon.py
"""
import math
import struct
import zlib
from pathlib import Path

SIZE = 256
OUT = Path(__file__).resolve().parent.parent / "assets"
TOP_LEFT = (0x5B, 0x6C, 0xFF)
BOTTOM_RIGHT = (0x8B, 0x5C, 0xF6)
RADIUS = 56
SS = 4  # supersampling para bordas suaves


def inside_rounded(x: float, y: float) -> bool:
    r = RADIUS
    cx = min(max(x, r), SIZE - r)
    cy = min(max(y, r), SIZE - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def hexagon(cx: float, cy: float, r: float):
    return [(cx + r * math.cos(math.radians(60 * i - 90)), cy + r * math.sin(math.radians(60 * i - 90))) for i in range(6)]


def point_in_poly(x: float, y: float, poly) -> bool:
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


OUTER = hexagon(SIZE / 2, SIZE / 2, 86)
INNER = hexagon(SIZE / 2, SIZE / 2, 62)


def pixel(px: int, py: int):
    cover = 0
    white = 0
    for sy in range(SS):
        for sx in range(SS):
            x = px + (sx + 0.5) / SS
            y = py + (sy + 0.5) / SS
            if inside_rounded(x, y):
                cover += 1
                if point_in_poly(x, y, OUTER) and not point_in_poly(x, y, INNER):
                    white += 1
    if cover == 0:
        return (0, 0, 0, 0)
    t = (px + py) / (2 * SIZE)
    base = [round(TOP_LEFT[k] + (BOTTOM_RIGHT[k] - TOP_LEFT[k]) * t) for k in range(3)]
    w = white / cover
    rgb = [round(base[k] * (1 - w) + 255 * w) for k in range(3)]
    return (*rgb, round(255 * cover / (SS * SS)))


def png(size_pixels):
    raw = b"".join(b"\x00" + b"".join(bytes(p) for p in row) for row in size_pixels)
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    h = len(size_pixels)
    w = len(size_pixels[0])
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rows = [[pixel(x, y) for x in range(SIZE)] for y in range(SIZE)]
    data = png(rows)
    (OUT / "icon.png").write_bytes(data)
    # ICO com a imagem PNG 256 px embutida (formato aceito pelo Windows Vista+).
    ico = struct.pack("<HHH", 0, 1, 1) + struct.pack("<BBBBHHII", 0, 0, 0, 0, 1, 32, len(data), 22) + data
    (OUT / "icon.ico").write_bytes(ico)
    print("ícone gerado em", OUT)


main()
