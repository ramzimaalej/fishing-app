#!/usr/bin/env python3
"""
Generate the Castmate app icons.

No image library is installed on this machine, so this writes PNGs directly:
zlib + struct from the standard library, with signed-distance-field coverage for
anti-aliasing. SDF rather than supersampling because it is both sharper and far
cheaper — a 4x supersample of 1024x1024 is 16.7M samples in pure Python, whereas
distance-per-pixel over each shape's local bounding box is a few hundred
thousand.

THE MARK. Taken from what the product actually is rather than a generic fish: a
rod bent under load, with the sensor at its tip broadcasting. That is literally
what the detector measures — angular deviation of the tip from its baseline —
and the radiating arcs are the advertisement stream the app listens to.

Colours are the app's own tokens (src/theme/index.ts), so the icon and the UI
cannot drift apart:
    bg      #0B1F2A   primary #2EC4B6   accent #FF9F1C
"""
import math
import struct
import zlib
from pathlib import Path

SIZE = 1024

BG = (0x0B, 0x1F, 0x2A)
TEAL = (0x2E, 0xC4, 0xB6)
TEAL_DIM = (0x1B, 0x9E, 0x92)
AMBER = (0xFF, 0x9F, 0x1C)


class Layer:
    """A single-colour coverage mask over the canvas."""

    def __init__(self, size=SIZE):
        self.size = size
        self.a = [0.0] * (size * size)

    def _blend(self, x, y, cov):
        if cov <= 0:
            return
        i = y * self.size + x
        if cov > self.a[i]:
            self.a[i] = 1.0 if cov > 1.0 else cov

    def _bbox(self, x0, y0, x1, y1, pad):
        return (
            max(0, int(min(x0, x1) - pad)),
            max(0, int(min(y0, y1) - pad)),
            min(self.size - 1, int(max(x0, x1) + pad)),
            min(self.size - 1, int(max(y0, y1) + pad)),
        )

    def capsule(self, x0, y0, x1, y1, r0, r1):
        """A line segment with independently rounded ends — a tapered stroke."""
        pad = max(r0, r1) + 2
        bx0, by0, bx1, by1 = self._bbox(x0, y0, x1, y1, pad)
        dx, dy = x1 - x0, y1 - y0
        length2 = dx * dx + dy * dy
        if length2 == 0:
            return
        for y in range(by0, by1 + 1):
            py = y + 0.5
            for x in range(bx0, bx1 + 1):
                px = x + 0.5
                t = ((px - x0) * dx + (py - y0) * dy) / length2
                t = 0.0 if t < 0 else (1.0 if t > 1 else t)
                cx, cy = x0 + t * dx, y0 + t * dy
                r = r0 + t * (r1 - r0)
                d = math.hypot(px - cx, py - cy) - r
                # Coverage from distance: the 1px band around d=0 is the edge.
                self._blend(x, y, 0.5 - d)

    def disc(self, cx, cy, r):
        bx0, by0, bx1, by1 = self._bbox(cx, cy, cx, cy, r + 2)
        for y in range(by0, by1 + 1):
            py = y + 0.5
            for x in range(bx0, bx1 + 1):
                px = x + 0.5
                self._blend(x, y, 0.5 - (math.hypot(px - cx, py - cy) - r))

    def ring(self, cx, cy, r, halfw, a_from, a_to):
        """An arc of a circle, angles in degrees, measured anticlockwise from +x."""
        pad = r + halfw + 2
        bx0, by0, bx1, by1 = self._bbox(cx, cy, cx, cy, pad)
        # Normalise BOTH bounds into [0, 2pi) like the pixel angle below.
        # Comparing a normalised angle against a raw negative bound silently
        # dropped everything from a_from..0, which truncated each arc while its
        # end-cap was still painted — leaving detached dots in the artwork.
        tau = 2 * math.pi
        a_from = math.radians(a_from) % tau
        a_to = math.radians(a_to) % tau
        for y in range(by0, by1 + 1):
            py = y + 0.5
            for x in range(bx0, bx1 + 1):
                px = x + 0.5
                vx, vy = px - cx, py - cy
                dist = math.hypot(vx, vy)
                if abs(dist - r) > halfw + 2:
                    continue
                ang = math.atan2(-vy, vx) % tau  # screen y grows downward
                lo, hi = a_from, a_to
                inside = lo <= ang <= hi if lo <= hi else (ang >= lo or ang <= hi)
                if not inside:
                    # Round the arc's ends rather than cutting them square.
                    for cap in (a_from, a_to):
                        ex, ey = cx + r * math.cos(cap), cy - r * math.sin(cap)
                        self._blend(x, y, 0.5 - (math.hypot(px - ex, py - ey) - halfw))
                    continue
                self._blend(x, y, 0.5 - (abs(dist - r) - halfw))

    def quad_stroke(self, p0, p1, p2, w0, w1, steps=160):
        """Quadratic Bezier drawn as a chain of tapered capsules."""
        prev = p0
        for i in range(1, steps + 1):
            t = i / steps
            u = 1 - t
            x = u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0]
            y = u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]
            tp = (i - 1) / steps
            self.capsule(prev[0], prev[1], x, y, w0 + tp * (w1 - w0), w0 + t * (w1 - w0))
            prev = (x, y)

    def bounds(self):
        """Tight bounding box of drawn coverage, or None when empty."""
        n = self.size
        x0, y0, x1, y1 = n, n, -1, -1
        for y in range(n):
            row = y * n
            for x in range(n):
                if self.a[row + x] > 0.02:
                    if x < x0:
                        x0 = x
                    if x > x1:
                        x1 = x
                    if y < y0:
                        y0 = y
                    if y > y1:
                        y1 = y
        return None if x1 < 0 else (x0, y0, x1, y1)

    def transformed(self, scale, tx, ty):
        """Resample through an inverse affine, with bilinear filtering."""
        out = Layer(self.size)
        n = self.size
        a = self.a
        for y in range(n):
            sy = (y - ty) / scale
            if sy < 0 or sy >= n - 1:
                continue
            iy = int(sy)
            fy = sy - iy
            row = iy * n
            row2 = row + n
            orow = y * n
            for x in range(n):
                sx = (x - tx) / scale
                if sx < 0 or sx >= n - 1:
                    continue
                ix = int(sx)
                fx = sx - ix
                v = (
                    a[row + ix] * (1 - fx) * (1 - fy)
                    + a[row + ix + 1] * fx * (1 - fy)
                    + a[row2 + ix] * (1 - fx) * fy
                    + a[row2 + ix + 1] * fx * fy
                )
                if v > 0:
                    out.a[orow + x] = v
        return out


def build_mark():
    """The rod, its tip sensor, and the broadcast — as separate colour layers."""
    rod = Layer()
    # Butt bottom-left, tip upper-right, bending as a rod does under load:
    # steep near the hand, flattening toward the tip.
    rod.quad_stroke((236, 838), (330, 442), (706, 330), w0=34, w1=11)

    signal = Layer()
    tip = (706, 330)
    # Two arcs radiating away from the tip. Angles chosen to open outward,
    # away from the rod, so the mark reads as "broadcasting" not "haloed".
    signal.ring(tip[0], tip[1], 118, 15, -30, 78)
    signal.ring(tip[0], tip[1], 182, 15, -18, 66)

    alert = Layer()
    alert.disc(tip[0], tip[1], 50)

    return rod, signal, alert


def fit(layers, target_fraction):
    """
    Scale and TRANSLATE the mark so its own bounds are centred and fill
    `target_fraction` of the canvas.

    Centring on the canvas is not enough: the mark's bounding box sits low-left
    of centre, so scaling about the canvas centre left it off-centre — which
    Android's circular mask would then clip unevenly. Adaptive icons only
    guarantee the central ~66%, so the mark has to be centred on its OWN bounds.
    """
    union = None
    for layer, _ in layers:
        b = layer.bounds()
        if b is None:
            continue
        union = b if union is None else (
            min(union[0], b[0]), min(union[1], b[1]),
            max(union[2], b[2]), max(union[3], b[3]),
        )
    if union is None:
        return layers

    x0, y0, x1, y1 = union
    w, h = x1 - x0 + 1, y1 - y0 + 1
    scale = (SIZE * target_fraction) / max(w, h)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    tx = SIZE / 2 - cx * scale
    ty = SIZE / 2 - cy * scale
    return [(layer.transformed(scale, tx, ty), colour) for layer, colour in layers]


def compose(layers, background=None, size=SIZE):
    """Painter's algorithm over an optionally transparent background."""
    px = bytearray(size * size * 4)
    for i in range(size * size):
        if background is not None:
            r, g, b, a = background[0], background[1], background[2], 1.0
        else:
            r = g = b = 0
            a = 0.0
        for layer, colour in layers:
            cov = layer.a[i]
            if cov <= 0:
                continue
            na = cov + a * (1 - cov)
            if na <= 0:
                continue
            r = (colour[0] * cov + r * a * (1 - cov)) / na
            g = (colour[1] * cov + g * a * (1 - cov)) / na
            b = (colour[2] * cov + b * a * (1 - cov)) / na
            a = na
        o = i * 4
        px[o] = int(r + 0.5)
        px[o + 1] = int(g + 0.5)
        px[o + 2] = int(b + 0.5)
        px[o + 3] = int(a * 255 + 0.5)
    return bytes(px)


def write_png(path, pixels, size=SIZE):
    raw = bytearray()
    stride = size * 4
    for y in range(size):
        raw.append(0)  # filter type 0 (None)
        raw += pixels[y * stride : (y + 1) * stride]

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    Path(path).write_bytes(png)
    return len(png)


def main():
    out = Path(__file__).resolve().parent.parent / "assets"
    out.mkdir(exist_ok=True)

    rod, signal, alert = build_mark()
    layers = [(signal, TEAL_DIM), (rod, TEAL), (alert, AMBER)]

    # Full-bleed icon: iOS and older Android launchers mask this themselves, so
    # the mark is centred with a comfortable margin rather than run to the edges.
    size = write_png(out / "icon.png", compose(fit(layers, 0.72), background=BG))
    print(f"icon.png            {size:>8} bytes")

    # Adaptive foreground: Android masks to a circle/squircle and only the
    # central ~66% is guaranteed visible, so the mark is scaled into that safe
    # zone and the background is a flat colour supplied via app config.
    safe = fit(layers, 0.60)
    size = write_png(out / "adaptive-icon.png", compose(safe, background=None))
    print(f"adaptive-icon.png   {size:>8} bytes")

    # Splash: same mark, transparent, a little smaller so it breathes.
    splash = fit(layers, 0.52)
    size = write_png(out / "splash-icon.png", compose(splash, background=None))
    print(f"splash-icon.png     {size:>8} bytes")


if __name__ == "__main__":
    main()
