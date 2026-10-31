#!/usr/bin/env python3
"""Generate the avatar *pool*: 256 plush folklore creatures, 256x256 JPEG.

The profile shows only 16 at a time — picked per user per day (see js/profile.js),
so the pool has to be wide enough that two people rarely see the same sixteen.

32 creatures x 8 colourways = 256 prompts. Resumable: an avatar that already
exists in img/avatars/pool/ is skipped, so the job can be re-run after a break.

Run:  /usr/bin/python3 tools/make_avatar_pool.py [--from N] [--to N]
Needs ComfyUI running (see the comfyui-image-generation skill) and ~60 min GPU
time for the full pool.
"""
import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
POOL = ROOT / "img" / "avatars" / "pool"
POOL.mkdir(parents=True, exist_ok=True)
OUTPUT = Path.home() / "comfy-gen" / "output"
GEN = Path.home() / "comfy-gen" / "comfy_gen.py"

CREATURES = [
    "troll with a mossy back and tiny horns",
    "hulder with a cow tail and long braided hair",
    "nisse with a red hat and a white beard",
    "draug with kelp strands and a small lantern",
    "selkie seal pup",
    "fossegrim water spirit with a tiny fiddle",
    "dwarf with a braided beard and a leather cap",
    "mare horse spirit with a long tangled mane",
    "baby lindorm serpent dragon with tiny wings",
    "ulda underground creature with round ears",
    "haldi mountain spirit with small rounded horns",
    "wind spirit with wispy fur and cloud-like ears",
    "forest guardian with twig antlers and moss",
    "jiehtanas giant, chunky and round",
    "water sprite with droplet-shaped ears",
    "reindeer calf with velvet antlers",
    "eagle chick with a short hooked beak",
    "arctic fox cub with a fluffy tail",
    "lynx cub with tufted ears",
    "snowy owl chick",
    "lemming, small and round",
    "wolverine cub",
    "bear cub",
    "raven chick",
    "snow hare with long ears",
    "elk calf",
    "wolf pup",
    "moth sprite with soft wings",
    "mushroom sprite with a spotted cap",
    "stone sprite with pebble texture",
    "moss sprite, fuzzy and green",
    "hearth spirit with a warm ember glow",
]

COLOURS = [
    "mossy green fur", "pale grey fur", "warm brown fur", "snowy white fur",
    "deep teal fur", "rust red fur", "midnight blue fur", "golden fur",
]

STYLE = ("big glossy eyes, soft studio lighting, plain pale grey background, "
         "centered full body, square, 3d render, no text")
NEG = ("text, letters, watermark, signature, scary, horror, realistic human, "
       "photo, logo, clutter, low quality, blurry, extra limbs")

TOTAL = len(CREATURES) * len(COLOURS)          # 256


def prompt_for(i):
    creature = CREATURES[i % len(CREATURES)]
    colour = COLOURS[(i // len(CREATURES)) % len(COLOURS)]
    return f"cute plush {creature}, {colour}, {STYLE}"


def crop(src, dst):
    im = Image.open(src).convert("RGB")
    w, h = im.size
    s = min(w, h)
    im = im.crop(((w - s) // 2, int((h - s) * 0.42), (w - s) // 2 + s, int((h - s) * 0.42) + s))
    im = im.resize((256, 256), Image.LANCZOS)
    im.save(dst, quality=85, optimize=True, progressive=True)


def write_manifest():
    files = sorted(p.name for p in POOL.glob("av-*.jpg"))
    manifest = ROOT / "img" / "avatars" / "pool.json"
    manifest.write_text(json.dumps(
        {"count": len(files), "files": [f"pool/{Path(f).stem}" for f in files]}, indent=1), encoding="utf-8")
    return manifest


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="start", type=int, default=0)
    ap.add_argument("--to", dest="end", type=int, default=TOTAL)
    args = ap.parse_args()

    manifest = ROOT / "img" / "avatars" / "pool.json"
    done, failed = 0, []
    for i in range(args.start, min(args.end, TOTAL)):
        dst = POOL / f"av-{i + 1:03d}.jpg"
        if dst.exists():
            continue
        prefix = f"avp-{i + 1:03d}"
        cmd = [sys.executable, str(GEN), prompt_for(i),
               "-n", NEG, "--preset", "fast", "--seed", str(9100 + i), "--prefix", prefix,
               "--out", str(OUTPUT)]
        t0 = time.time()
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
            line = [l for l in res.stdout.strip().splitlines() if l.startswith("{")]
            if not line:
                raise RuntimeError((res.stderr or res.stdout)[-200:])
            info = json.loads(line[-1])
            if not info.get("ok"):
                raise RuntimeError(str(info)[:200])
            crop(info["files"][0], dst)
            done += 1
            if done % 10 == 0:
                write_manifest()
            print(f"[{i + 1}/{TOTAL}] {dst.name}  {time.time() - t0:.1f}s", flush=True)
        except Exception as e:
            failed.append((i + 1, str(e)[:120]))
            print(f"[{i + 1}/{TOTAL}] FEIL: {e}", flush=True)

    files = sorted(p.name for p in POOL.glob("av-*.jpg"))
    manifest.write_text(json.dumps(
        {"count": len(files), "files": [f"pool/{Path(f).stem}" for f in files],
         "generated": time.strftime("%Y-%m-%d")}, indent=1), encoding="utf-8")
    print(f"\nferdig: {done} nye, {len(files)} i poolen, {len(failed)} feila -> {manifest}")
    for idx, err in failed[:10]:
        print("  feil", idx, err)


if __name__ == "__main__":
    main()
