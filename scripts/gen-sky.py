#!/usr/bin/env python3
"""
Renders the cloud skies in public/sky/ on this machine. No image service, no
credits. A cloud here is a pile of shaded soft spheres: banks of cumulus are
painted far to near, then the whole picture is warped with noise so the
circles turn into cloud edges. Same seed, same sky.

    python3 scripts/gen-sky.py            # all scenes
    python3 scripts/gen-sky.py golden     # one scene

Env: SKY_SCALE=0.5 for a quick preview, SKY_OUT=dir to write somewhere else.
Needs numpy, scipy and Pillow.
"""
import os
import sys
import time

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, map_coordinates

SCALE = float(os.environ.get('SKY_SCALE', 1))
W, H = int(1920 * SCALE), int(1200 * SCALE)
OUT = os.environ.get('SKY_OUT', os.path.join(os.path.dirname(__file__), '..', 'public', 'sky'))


def hexc(s):
    s = s.lstrip('#')
    return np.array([int(s[i : i + 2], 16) for i in (0, 2, 4)], dtype=np.float32) / 255


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def fbm(w, h, rng, base, octaves=5):
    """Smooth noise in -1..1 with features about `base` pixels wide."""
    out = np.zeros((h, w), dtype=np.float32)
    amp, sigma = 1.0, base
    for _ in range(octaves):
        layer = gaussian_filter(rng.normal(size=(h, w)).astype(np.float32), sigma, mode='wrap')
        out += amp * layer / (np.abs(layer).max() + 1e-6)
        amp *= 0.55
        sigma = max(1.0, sigma / 2)
    return out / np.abs(out).max()


def ramp(light, scene):
    """Shadow -> mid -> lit, in the scene's own colors."""
    a = smooth(0.0, 0.55, light)[..., None]
    b = smooth(0.5, 1.0, light)[..., None]
    col = scene['_shadow'] * (1 - a) + scene['_mid'] * a
    return col * (1 - b) + scene['_lit'] * b


def puff(canvas, cx, cy, r, sun, scene, haze, lift):
    """One shaded soft sphere, composited over the canvas."""
    h, w = canvas.shape[:2]
    r = max(r, 1.5)
    x0, x1 = int(max(cx - r - 2, 0)), int(min(cx + r + 3, w))
    y0, y1 = int(max(cy - r - 2, 0)), int(min(cy + r + 3, h))
    if x1 <= x0 or y1 <= y0:
        return
    ys, xs = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    nx = (xs - cx) / r
    ny = (ys - cy) / r
    d2 = nx * nx + ny * ny
    nz = np.sqrt(np.clip(1 - d2, 0, 1))
    wrap = scene.get('wrap', 0.42)
    light = np.clip((nx * sun[0] + ny * sun[1] + nz * sun[2] + wrap) / (1 + wrap), 0, 1)
    light = light * (0.55 + 0.45 * lift)
    rim = np.clip(d2, 0, 1) ** 3 * np.clip(nx * sun[0] + ny * sun[1] + 0.3, 0, 1)
    col = ramp(light, scene) + scene['_rim'] * (rim * scene.get('rim_gain', 0.5))[..., None]
    col = col * (1 - haze) + scene['_haze'] * haze
    alpha = (1 - smooth(0.78, 1.0, np.sqrt(d2)))[..., None]
    canvas[y0:y1, x0:x1] = canvas[y0:y1, x0:x1] * (1 - alpha) + col * alpha


def tower(canvas, x, y, r, depth, rng, sun, scene, haze, top):
    """A cumulus head: big puffs lower down, smaller ones budding off the top."""
    if depth == 0 or r < 2.2:
        return
    # Children first, so the parent's body sits in front and overlaps their bases.
    kids = rng.integers(3, 6)
    for _ in range(kids):
        ang = rng.uniform(-np.pi * 0.95, -np.pi * 0.05)
        dist = r * rng.uniform(0.62, 0.98)
        tower(canvas, x + np.cos(ang) * dist * 1.25, y + np.sin(ang) * dist * 0.82, r * rng.uniform(0.5, 0.74), depth - 1, rng, sun, scene, haze, top)
    lift = np.clip(1 - (y - top) / (r * 7 + 1), 0.15, 1)
    puff(canvas, x, y, r, sun, scene, haze, lift)


def render(scene):
    t0 = time.time()
    rng = np.random.default_rng(scene['seed'])
    for k in ('shadow', 'mid', 'lit', 'rim'):
        scene['_' + k] = hexc(scene[k])

    sun = np.array(scene['sun'], dtype=np.float32)
    sun /= np.linalg.norm(sun)

    # Sky: a vertical wash plus a wide, soft bloom where the light comes from. No disk.
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    v = yy / H
    stops = np.stack([hexc(c) for c in scene['sky']])
    idx = np.clip(v / scene['horizon'], 0, 1) * (len(stops) - 1)
    i0 = np.clip(idx.astype(int), 0, len(stops) - 2)
    f = (idx - i0)[..., None]
    img = stops[i0] * (1 - f) + stops[i0 + 1] * f
    gx, gy = scene['glow_at']
    dist = np.sqrt(((xx / W - gx) * 1.6) ** 2 + (v - gy) ** 2)
    bloom = np.exp(-(dist / scene.get('glow_size', 0.34)) ** 2) * scene.get('glow_gain', 0.8)
    img = img * (1 - bloom[..., None]) + hexc(scene['glow']) * bloom[..., None]

    # Banks of cloud, far to near. Far ones are small and sunk into the haze.
    bands = scene.get('bands', 7)
    horizon = scene['horizon']
    haze_c = hexc(scene['haze'])
    for b in range(bands):
        depth01 = b / (bands - 1)
        scene['_haze'] = haze_c
        haze = (1 - depth01) ** 1.7 * scene.get('haze_gain', 0.82)
        base = (horizon + (1.08 - horizon) * depth01 ** 1.35) * H
        size = (0.018 + 0.1 * depth01 ** 1.5) * W * scene.get('size', 1)
        count = int(scene.get('density', 1) * (46 - 34 * depth01))
        ridge = gaussian_filter(rng.normal(size=W + 400).astype(np.float32), 90 * SCALE + 12)
        ridge /= np.abs(ridge).max()
        xs = np.sort(rng.uniform(-size, W + size, count))
        # Solid body under the bank, so nothing behind it shows through the gaps.
        body = scene['_shadow'] * (1 - haze) + haze_c * haze
        line = base + ridge[(np.arange(W) + 200)] * size * 1.1
        mask = smooth(-size * 0.25, size * 0.5, yy - line[None, :])[..., None]
        img = img * (1 - mask) + body * mask
        for x in xs:
            y = base + ridge[int(np.clip(x + 200, 0, W + 399))] * size * 1.1 + rng.uniform(-0.2, 0.3) * size
            r = size * rng.uniform(0.6, 1.2)
            tower(img, x, y, r, 4, rng, sun, scene, haze, base - size * 3)

    # Warp: this is what turns circles into cloud. Big drift, then fine fraying.
    coarse = 26 * SCALE * scene.get('warp', 1)
    fine = 7 * SCALE * scene.get('warp', 1)
    dx = fbm(W, H, rng, 34 * SCALE + 4) * coarse + fbm(W, H, rng, 7 * SCALE + 2, 3) * fine
    dy = fbm(W, H, rng, 34 * SCALE + 4) * coarse * 0.7 + fbm(W, H, rng, 7 * SCALE + 2, 3) * fine
    img = np.stack([map_coordinates(img[..., c], [yy + dy, xx + dx], order=1, mode='nearest') for c in range(3)], -1)
    img = gaussian_filter(img, sigma=(1.3 * SCALE + 0.2, 1.3 * SCALE + 0.2, 0))
    img = np.clip(img, 0, 1)

    # A hair of noise stops the long gradients from banding in the WebP.
    img = np.clip(img + rng.normal(0, 1.2 / 255, img.shape), 0, 1)

    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f"{scene['name']}.webp")
    Image.fromarray((img * 255).astype(np.uint8)).save(path, 'WEBP', quality=76, method=6)
    print(f"{scene['name']:<8} {time.time() - t0:5.1f}s  {os.path.getsize(path) // 1024} KB")


# Sun vectors: x right, y down (so negative is up), z toward the viewer.
SCENES = {
    # Dusk: the light is low and behind, the tops are toasted, the bellies go dark.
    'golden': dict(
        name='golden', seed=11, horizon=0.5, sun=(0.42, -0.55, 0.5),
        sky=['#23120e', '#5c2415', '#b5491a', '#f08a22', '#ffc25a'],
        glow='#ffc766', glow_at=(0.68, 0.46), glow_size=0.3, glow_gain=0.72,
        shadow='#2c1410', mid='#a8431c', lit='#ffc562', rim='#ffdf9a', haze='#f0912e', haze_gain=0.72,
    ),
    # Noon inside the bag: the whole sky is the seasoning.
    'dust': dict(
        name='dust', seed=23, horizon=0.36, sun=(-0.35, -0.8, 0.45),
        sky=['#ff9a0a', '#ffae1a', '#ffc23a', '#ffd35e'],
        glow='#fff0a8', glow_at=(0.28, 0.1), glow_size=0.5, glow_gain=0.5,
        shadow='#f06c00', mid='#ffa213', lit='#ffeaa0', rim='#fff6cf', haze='#ffc445', haze_gain=0.62, wrap=0.55,
    ),
    # Morning above the weather: butter sky, white tops, peach shadows.
    'nine': dict(
        name='nine', seed=37, horizon=0.42, sun=(0.5, -0.7, 0.55),
        sky=['#ffcf7a', '#ffdc97', '#ffe9ba', '#fff4d8'],
        glow='#fffbea', glow_at=(0.74, 0.2), glow_size=0.42, glow_gain=0.7,
        shadow='#f4b078', mid='#ffdfb8', lit='#fffdf7', rim='#ffffff', haze='#ffeccb', haze_gain=0.7, wrap=0.6,
    ),
}

if __name__ == '__main__':
    for name in sys.argv[1:] or list(SCENES):
        render(SCENES[name])
