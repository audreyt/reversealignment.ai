#!/usr/bin/env python3
"""Extract fitting and production meshes from a temporal median of the reference loop."""

from __future__ import annotations

import argparse
from pathlib import Path
import subprocess
import tempfile

import numpy as np
from PIL import Image, ImageDraw


VIEWBOX_WIDTH = 165.217
VIEWBOX_HEIGHT = 100
RIM_X = 109.105
RIM_Y = 50.675
RIM_RADIUS = 58.226
RIM_ASPECT = 0.74275
RIM_ROLL_DEG = -19.64


def close_clipped_outer_rim(cleaned: np.ndarray) -> np.ndarray:
    """Close the few pixels of the measured outer rim clipped by the source frame."""

    height, width = cleaned.shape[:2]
    theta = np.linspace(0, 2 * np.pi, 4096, endpoint=False)
    roll = np.deg2rad(RIM_ROLL_DEG)
    local_x = RIM_RADIUS * np.cos(theta)
    local_y = RIM_RADIUS * RIM_ASPECT * np.sin(theta)
    source_x = (
        RIM_X + local_x * np.cos(roll) - local_y * np.sin(roll)
    ) / VIEWBOX_WIDTH * width
    source_y = (
        RIM_Y + local_x * np.sin(roll) + local_y * np.cos(roll)
    ) / VIEWBOX_HEIGHT * height

    # The fitted ellipse exceeds the canonical 1900px frame by only 7.1px.
    # Fold that unavailable sliver into a boundary-hugging 1px arc. This
    # connects the two real edge blooms without moving or rescaling any
    # measured pixel elsewhere in the mesh.
    edge = width - 1.75
    clipped = source_x >= width - 2
    repaired_x = edge - np.maximum(source_x[clipped] - edge, 0) * 0.12
    repaired_y = source_y[clipped]

    supersample = 4
    pad = 5
    left = max(0, int(np.floor(np.min(repaired_x))) - pad)
    top = max(0, int(np.floor(np.min(repaired_y))) - pad)
    right = width
    bottom = min(height, int(np.ceil(np.max(repaired_y))) + pad + 1)
    overlay = Image.new(
        "RGBA", ((right - left) * supersample, (bottom - top) * supersample)
    )
    draw = ImageDraw.Draw(overlay)
    coords = [
        ((x - left) * supersample, (y - top) * supersample)
        for x, y in zip(repaired_x, repaired_y, strict=True)
    ]
    draw.line(
        coords,
        fill=(70, 72, 71, 72),
        width=4 * supersample,
        joint="curve",
    )
    draw.line(
        coords,
        fill=(83, 86, 84, 230),
        width=1 * supersample,
        joint="curve",
    )
    overlay = overlay.resize((right - left, bottom - top), Image.Resampling.LANCZOS)

    repaired = Image.fromarray(cleaned).convert("RGBA")
    repaired.alpha_composite(overlay, (left, top))
    return np.asarray(repaired.convert("RGB"))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("video", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--samples", type=int, default=43)
    parser.add_argument("--width", type=int, default=1900)
    parser.add_argument(
        "--fit-output",
        type=Path,
        help="optional unpatched median for fit-hero-mesh.py",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=args.output.parent) as directory:
        pattern = Path(directory) / "frame-%03d.png"
        subprocess.run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(args.video),
                "-vf",
                f"fps={args.samples}/8.6,scale={args.width}:-2",
                str(pattern),
            ],
            check=True,
        )
        frame_paths = sorted(Path(directory).glob("frame-*.png"))
        if len(frame_paths) < args.samples - 1:
            raise RuntimeError(f"decoded only {len(frame_paths)} reference frames")
        frames = [np.asarray(Image.open(path).convert("RGB")) for path in frame_paths]

    # The mesh is stationary while every bright particle moves. The median
    # therefore keeps the wireframe and rejects particle bodies and glows.
    cleaned = np.median(np.stack(frames), axis=0).astype(np.uint8)
    if args.fit_output:
        args.fit_output.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(cleaned).save(args.fit_output, optimize=True)
    cleaned = close_clipped_outer_rim(cleaned)
    Image.fromarray(cleaned).save(args.output, optimize=True)


if __name__ == "__main__":
    main()
