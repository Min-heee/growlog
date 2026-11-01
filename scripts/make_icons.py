#!/usr/bin/env python3
"""앱 아이콘(새싹)을 만든다. 외부 라이브러리 없이 돌아가도록 PNG를 직접 쓴다.

사용법: python3 scripts/make_icons.py
"""
import math
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'icons'
IOS_ICON = ROOT / 'ios/GrowLog/Assets.xcassets/AppIcon.appiconset/icon-1024.png'
BACKGROUND = (10, 11, 13)
SPROUT = (198, 255, 61)
SAMPLES = 3  # 픽셀당 가로·세로 표본 수 (가장자리를 부드럽게)
CORNER = 0.22

# 그림은 모두 중앙 지름 80% 안에 들어간다. 안드로이드가 원이나 둥근 사각형으로 잘라도 잘리지 않는다.
LEAVES = [
    # 기준점, 끝점, 폭, 휘어짐
    ((0.50, 0.53), (0.77, 0.26), 0.125, -0.03),
    ((0.50, 0.62), (0.25, 0.42), 0.095, 0.025),
]
STEM = ((0.50, 0.78), (0.50, 0.50), 0.034)


def in_leaf(x, y, base, tip, width, bend):
    dx, dy = tip[0] - base[0], tip[1] - base[1]
    length = math.hypot(dx, dy)
    u = ((x - base[0]) * dx + (y - base[1]) * dy) / length
    if not 0 <= u <= length:
        return False
    v = (-(x - base[0]) * dy + (y - base[1]) * dx) / length
    shape = math.sin(math.pi * u / length)
    return abs(v - bend * shape) <= width * shape


def in_stem(x, y):
    (ax, ay), (bx, by), radius = STEM
    t = max(0.0, min(1.0, (y - ay) / (by - ay)))
    return math.hypot(x - (ax + (bx - ax) * t), y - (ay + (by - ay) * t)) <= radius


def in_sprout(x, y):
    return in_stem(x, y) or any(in_leaf(x, y, *leaf) for leaf in LEAVES)


def in_rounded_square(x, y):
    cx = min(x, 1 - x)
    cy = min(y, 1 - y)
    if cx >= CORNER or cy >= CORNER:
        return True
    return math.hypot(CORNER - cx, CORNER - cy) <= CORNER


def coverage(size, test):
    """픽셀마다 도형이 덮는 비율을 0~255로 구한다."""
    step = 1 / (size * SAMPLES)
    offsets = [(i + 0.5) * step for i in range(SAMPLES)]
    total = SAMPLES * SAMPLES
    result = bytearray(size * size)
    for py in range(size):
        for px in range(size):
            hits = sum(test(px / size + ox, py / size + oy) for oy in offsets for ox in offsets)
            result[py * size + px] = hits * 255 // total
    return result


def chunk(tag, data):
    return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data))


def write_png(path, size, rgba, opaque=False):
    if opaque:  # 앱스토어는 알파 채널이 있는 아이콘을 받지 않는다
        del rgba[3::4]
    stride = size * (3 if opaque else 4)
    raw = b''.join(b'\0' + bytes(rgba[y * stride : (y + 1) * stride]) for y in range(size))
    header = struct.pack('>IIBBBBB', size, size, 8, 2 if opaque else 6, 0, 0, 0)
    path.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', header) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))
    print(f'{path.name}: {path.stat().st_size / 1024:.1f} KB')


def render(size, sprout, rounded):
    mask = coverage(size, in_rounded_square) if rounded else None
    rgba = bytearray(size * size * 4)
    for y in range(size):
        for x in range(size):
            i = y * size + x
            cover = sprout[i] / 255
            o = i * 4
            for c in range(3):
                rgba[o + c] = round(BACKGROUND[c] + (SPROUT[c] - BACKGROUND[c]) * cover)
            rgba[o + 3] = mask[i] if rounded else 255
    return rgba


def main():
    OUT.mkdir(exist_ok=True)
    for size, files in {
        512: [('icon-512.png', True), ('icon-maskable-512.png', False)],
        192: [('icon-192.png', True), ('icon-maskable-192.png', False)],
        180: [('apple-touch-icon.png', False)],  # iOS는 투명 부분을 검게 칠하고 모서리는 직접 둥글린다
    }.items():
        sprout = coverage(size, in_sprout)
        for name, rounded in files:
            write_png(OUT / name, size, render(size, sprout, rounded))
    write_png(IOS_ICON, 1024, render(1024, coverage(1024, in_sprout), False), opaque=True)


if __name__ == '__main__':
    main()
