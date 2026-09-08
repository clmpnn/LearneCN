#!/usr/bin/env python3
# LearneCN — https://github.com/clmpnn/LearneCN
# Copyright (C) 2026 clmpnn
#
# This program is free software: you can redistribute it and/or modify it under
# the terms of the GNU General Public License as published by the Free Software
# Foundation, either version 3 of the License, or (at your option) any later
# version.
#
# This program is distributed in the hope that it will be useful, but WITHOUT ANY
# WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
# PARTICULAR PURPOSE. See the GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License along with
# this program. If not, see <https://www.gnu.org/licenses/>.
#
# SPDX-License-Identifier: GPL-3.0-or-later
"""Draw the home-screen icons and iOS launch images.

The mark is redrawn here rather than rasterised from favicon.svg, because the
three contexts want three different framings and none of them is the favicon:

  home-screen icon   iOS masks it to a squircle, so it must be full-bleed with
                     no rounded corners of its own and the stroke pulled well
                     inside the crop
  maskable icon      Android may crop to a circle; everything important has to
                     sit inside the middle 60%
  launch image       the mark alone on the app's own paper, at the exact pixel
                     size of each device, because iOS matches on exact size and
                     shows white when nothing matches

Needs Pillow (pip install pillow). Outputs are committed; run this only when
the mark changes.
"""

import os
import sys

try:
    from PIL import Image, ImageDraw
except ImportError:
    sys.exit('This script needs Pillow: pip install pillow')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS = os.path.join(ROOT, 'icons')

CINNABAR = (168, 42, 28)
PAPER_LIGHT = (242, 236, 224)
PAPER_DARK = (23, 22, 19)
WHITE = (255, 255, 255)

SS = 4          # supersample factor; downsampled at the end for clean edges


def quad(p0, p1, p2, steps=220):
    """Sample a quadratic Bezier — the 丿 falling stroke."""
    out = []
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        out.append((u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
                    u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]))
    return out


def stroke(draw, points, width, fill):
    """Draw a smooth stroke of constant width along a curve.

    PIL's wide polylines are drawn segment by segment and come out visibly
    lumpy on a curve. Building the outline instead — walk the curve offsetting
    half a width to each side, then fill the resulting polygon — gives a clean
    edge, and two circles finish the round caps.
    """
    r = width / 2.0
    left, right = [], []
    n = len(points)
    for i, (x, y) in enumerate(points):
        px, py = points[max(i - 1, 0)]
        nx, ny = points[min(i + 1, n - 1)]
        dx, dy = nx - px, ny - py
        length = (dx * dx + dy * dy) ** 0.5 or 1.0
        # unit normal to the tangent
        ux, uy = -dy / length, dx / length
        left.append((x + ux * r, y + uy * r))
        right.append((x - ux * r, y - uy * r))
    draw.polygon(left + right[::-1], fill=fill)
    for x, y in (points[0], points[-1]):
        draw.ellipse([x - r, y - r, x + r, y + r], fill=fill)


def draw_mark(size, inset, bg, rounded=0, grid=True):
    """The 田字格 with one stroke through it, drawn in a `size` square.

    `inset` is the share of the square left empty around the mark — 0 for a
    full-bleed icon, more for anything that will be cropped.
    """
    n = size * SS
    img = Image.new('RGB', (n, n), bg)
    d = ImageDraw.Draw(img, 'RGBA')

    if rounded:
        # only used for the plain PNG favicon; iOS supplies its own shape
        mask = Image.new('L', (n, n), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, n - 1, n - 1],
                                               radius=int(rounded * n), fill=255)
        base = Image.new('RGB', (n, n), PAPER_LIGHT)
        base.paste(img, (0, 0), mask)
        img = base
        d = ImageDraw.Draw(img, 'RGBA')

    pad = n * inset
    box = n - 2 * pad
    u = box / 32.0                       # the favicon's 32-unit coordinate space
    ox, oy = pad, pad

    def P(x, y):
        return (ox + x * u, oy + y * u)

    if grid:
        gw = max(1.0, 1.1 * u)
        g = (255, 255, 255, 87)          # 34% white, as in the favicon
        d.line([P(16, 3.5), P(16, 28.5)], fill=g, width=int(round(gw)))
        d.line([P(3.5, 16), P(28.5, 16)], fill=g, width=int(round(gw)))

    stroke(d, quad(P(21.6, 8.2), P(17.8, 16.4), P(10.2, 23.4)), 3.7 * u, WHITE)
    return img.resize((size, size), Image.LANCZOS)


def splash(w, h, dark):
    """A launch image: the app's paper, with the icon centred."""
    bg = PAPER_DARK if dark else PAPER_LIGHT
    img = Image.new('RGB', (w, h), bg)
    side = int(min(w, h) * 0.22)
    side -= side % 2
    icon = draw_mark(side, 0.16, CINNABAR, rounded=0.2)
    img.paste(icon, ((w - side) // 2, (h - side) // 2))
    return img


# Portrait sizes in device pixels. iOS matches on exact dimensions and falls
# back to a blank white screen when nothing matches, so this list is the
# coverage. Landscape is left out deliberately: nobody studies flashcards
# sideways, and doubling the file count to cover it is not worth the bytes.
SPLASH = [
    (1320, 2868),   # iPhone 16 Pro Max
    (1290, 2796),   # iPhone 15/14 Pro Max, 15/16 Plus
    (1206, 2622),   # iPhone 16 Pro
    (1179, 2556),   # iPhone 16/15/14 Pro
    (1170, 2532),   # iPhone 14/13/13 Pro/12
    (1125, 2436),   # iPhone 11 Pro/XS/X
    (1080, 2340),   # iPhone 13/12 mini
    (828, 1792),    # iPhone 11/XR
    (750, 1334),    # iPhone SE, 8
    (2048, 2732),   # iPad Pro 12.9
    (1668, 2388),   # iPad Pro 11
    (1640, 2360),   # iPad Air 10.9, iPad 10th
    (1536, 2048),   # iPad mini, iPad 9.7
]


def main():
    os.makedirs(ICONS, exist_ok=True)
    total = 0

    def save(img, name):
        nonlocal total
        path = os.path.join(ICONS, name)
        img.save(path, 'PNG', optimize=True)
        size = os.path.getsize(path)
        total += size
        print(f'  {name:<34} {img.size[0]:>4}x{img.size[1]:<4} {size / 1024:7.1f} KB')

    print('Home-screen icons')
    # Full bleed, no corner rounding: iOS applies the squircle itself, and an
    # icon that rounds its own corners first ends up with pale notches.
    save(draw_mark(180, 0.14, CINNABAR), 'apple-touch-icon.png')
    save(draw_mark(192, 0.14, CINNABAR), 'icon-192.png')
    save(draw_mark(512, 0.14, CINNABAR), 'icon-512.png')
    # Maskable: everything meaningful inside the middle 60%.
    save(draw_mark(512, 0.26, CINNABAR), 'icon-maskable-512.png')
    save(draw_mark(32, 0.10, CINNABAR, rounded=0.2), 'favicon-32.png')

    print('\nLaunch images')
    for w, h in SPLASH:
        save(splash(w, h, False), f'splash-{w}x{h}.png')
        save(splash(w, h, True), f'splash-{w}x{h}-dark.png')

    print(f'\n  {"total":<34} {"":>9} {total / 1024:7.1f} KB')
    return 0


if __name__ == '__main__':
    sys.exit(main())
