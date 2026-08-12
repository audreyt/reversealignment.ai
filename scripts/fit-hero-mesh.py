#!/usr/bin/env python3
"""Fit the procedural hero projection to the cleaned reference wire pixels."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import distance_transform_edt, gaussian_filter, map_coordinates
from scipy.optimize import differential_evolution

VIEWBOX_WIDTH = 165.217
VIEWBOX_HEIGHT = 100.0
RINGS = np.arange(1, 14, dtype=float) / 13
SPOKE_PINCH = 0.002
REFERENCE_WIDTH = 1900
REFERENCE_HEIGHT = 1150
ASPECT_BASE = 0.74275
RIDGE_SCALES = (1.5, 2.0, 2.5)


def smooth(value: np.ndarray) -> np.ndarray:
    return value * value * (3 - 2 * value)


def find_throat(gray: np.ndarray) -> tuple[float, float]:
    """Intersect inner-spoke ridge tangents to locate the dark singularity."""

    height, width = gray.shape
    yy, xx = np.mgrid[:height, :width]
    scale = width / REFERENCE_WIDTH
    estimates: list[np.ndarray] = []

    for sigma in RIDGE_SCALES:
        image_xx = gaussian_filter(gray, sigma * scale, order=(0, 2))
        image_yy = gaussian_filter(gray, sigma * scale, order=(2, 0))
        image_xy = gaussian_filter(gray, sigma * scale, order=(1, 1))
        trace = (image_xx + image_yy) / 2
        spread = np.sqrt(((image_xx - image_yy) / 2) ** 2 + image_xy**2)
        ridge = trace - spread
        cross = trace + spread

        # The eigenvector for the most-negative Hessian eigenvalue is the wire
        # normal. Intersecting its tangent constraints recovers the convergence
        # point even though that point itself is dark and absent from the wire
        # threshold used by the distance-field objective.
        normal_x = image_xy
        normal_y = ridge - image_xx
        magnitude = np.hypot(normal_x, normal_y)
        normal_x = np.divide(
            normal_x, magnitude, out=np.zeros_like(normal_x), where=magnitude > 1e-9
        )
        normal_y = np.divide(
            normal_y, magnitude, out=np.zeros_like(normal_y), where=magnitude > 1e-9
        )
        candidates = (
            (xx >= width * (1050 / REFERENCE_WIDTH))
            & (xx <= width * (1510 / REFERENCE_WIDTH))
            & (yy >= height * (520 / REFERENCE_HEIGHT))
            & (yy <= height * (880 / REFERENCE_HEIGHT))
            & (gray > 14)
            & (ridge < 0)
            & (np.abs(ridge) > 2 * np.abs(cross))
            & (magnitude > 1e-9)
        )
        centre = np.array(
            [width * (1245 / REFERENCE_WIDTH), height * (775 / REFERENCE_HEIGHT)]
        )

        for iteration in range(8):
            delta_x = xx - centre[0]
            delta_y = yy - centre[1]
            radius = np.hypot(delta_x, delta_y)
            miss = np.abs(normal_x * delta_x + normal_y * delta_y)
            selected = (
                candidates
                & (radius > 30 * scale)
                & (radius < 270 * scale)
                & (miss < max(35, 90 / (iteration + 1)) * scale)
            )
            weights = np.maximum(-ridge, 0) / (1 + (miss / (8 * scale)) ** 2)
            matrix = np.column_stack((normal_x[selected], normal_y[selected]))
            target = normal_x[selected] * xx[selected] + normal_y[selected] * yy[selected]
            root_weights = np.sqrt(weights[selected])
            centre = np.linalg.lstsq(
                matrix * root_weights[:, None], target * root_weights, rcond=None
            )[0]

        estimates.append(centre)

    throat_px = np.median(np.stack(estimates), axis=0)
    return (
        float(throat_px[0] / width * VIEWBOX_WIDTH),
        float(throat_px[1] / height * VIEWBOX_HEIGHT),
    )


def points(
    params: np.ndarray, throat: tuple[float, float]
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    aspect_gain, migrate_start, migrate_end = params[:3]
    twist, wind_start, wind_end, fold_flatten, bend_x, bend_y = params[3:]
    throat_x, throat_y = throat
    roll = np.deg2rad(-19.64)
    rim_x, rim_y, rim_radius = 109.105, 50.675, 58.226
    cos_roll, sin_roll = np.cos(roll), np.sin(roll)

    def surface_values(
        radius: np.ndarray,
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        fold = smooth(np.clip((0.08 - radius) / 0.08, 0, 1))
        aspect = (ASPECT_BASE + aspect_gain * (1 - radius)) * (1 - fold_flatten * fold)
        migrate = smooth(np.clip((migrate_start - radius) / (migrate_start - migrate_end), 0, 1))
        curve = 4 * migrate * (1 - migrate)
        centre_x = rim_x + (throat_x - rim_x) * migrate + curve * bend_x
        centre_y = rim_y + (throat_y - rim_y) * migrate + curve * bend_y
        return aspect, centre_x, centre_y

    def surface(radius: np.ndarray, theta: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        aspect, centre_x, centre_y = surface_values(radius)
        wind = smooth(np.clip((wind_start - radius) / (wind_start - wind_end), 0, 1))
        angle = theta + twist * wind
        major = rim_radius * radius
        minor = major * aspect
        local_x = major * np.cos(angle)
        local_y = minor * np.sin(angle)
        return (
            centre_x + local_x * cos_roll - local_y * sin_roll,
            centre_y + local_x * sin_roll + local_y * cos_roll,
        )

    ring_r = np.repeat(RINGS[:, None], 96, axis=1)
    ring_t = np.repeat(np.linspace(0, 2 * np.pi, 96, endpoint=False)[None, :], 13, axis=0)
    aspect, centre_x, centre_y = surface_values(ring_r)
    major = 58.226 * ring_r
    minor = major * aspect
    local_x = major * np.cos(ring_t)
    local_y = minor * np.sin(ring_t)
    ring_x = centre_x + local_x * cos_roll - local_y * sin_roll
    ring_y = centre_y + local_x * sin_roll + local_y * cos_roll

    spoke_r = np.repeat(np.linspace(SPOKE_PINCH, 1, 72)[None, :], 52, axis=0)
    spoke_t = np.repeat(
        (0.016 + np.arange(52) * 2 * np.pi / 52)[:, None], 72, axis=1
    )
    spoke_x, spoke_y = surface(spoke_r, spoke_t)
    radii = np.concatenate((ring_r.ravel(), spoke_r.ravel()))
    return (
        np.concatenate((ring_x.ravel(), spoke_x.ravel())),
        np.concatenate((ring_y.ravel(), spoke_y.ravel())),
        radii,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("image", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--preview", type=Path)
    args = parser.parse_args()

    image = Image.open(args.image).convert("RGB")
    if image.size != (REFERENCE_WIDTH, REFERENCE_HEIGHT):
        raise ValueError(
            "the canonical fit requires a 1900×1150 cleaned frame; "
            f"received {image.width}×{image.height}"
        )
    gray = np.asarray(image.convert("L"), dtype=float)
    # Production closes the source video's clipped outer rim after extracting
    # the temporal median. That synthetic five-pixel edge must not vote in the
    # geometry fit: use extract-hero-mesh.py --fit-output as this input.
    repaired_edge = gray[430:531, 1895:1900]
    if np.min(np.max(repaired_edge, axis=1)) > 50:
        raise ValueError(
            "the fitter requires the unpatched temporal median; "
            "pass the file generated by extract-hero-mesh.py --fit-output"
        )
    throat = find_throat(gray)
    wire = gray >= 18
    distance = distance_transform_edt(~wire)
    height, width = gray.shape

    def loss(params: np.ndarray) -> float:
        migrate_start, migrate_end = params[1:3]
        wind_start, wind_end = params[4:6]
        if migrate_start <= migrate_end + 0.03 or wind_start <= wind_end + 0.02:
            return 1e9
        x, y, radii = points(params, throat)
        px = x / VIEWBOX_WIDTH * width
        py = y / VIEWBOX_HEIGHT * height
        sampled = map_coordinates(distance, [py, px], order=1, mode="constant", cval=30)
        if not np.all(np.isfinite(sampled)):
            return 1e9
        error = np.minimum(sampled, 15) ** 1.35
        # Give the core, middle, and rim equal votes. The old global mean let
        # thousands of easy outer-wire samples trade away the singularity.
        radial_bands = (
            radii < 0.25,
            (radii >= 0.25) & (radii < 0.65),
            radii >= 0.65,
        )
        return float(np.mean([np.mean(error[band]) for band in radial_bands]))

    bounds = [
        (0.05, 0.24),
        (0.28, 0.8),
        (0.04, 0.24),
        (-0.6, -0.1),
        (0.3, 0.65),
        (0.01, 0.15),
        (0.0, 0.9),
        (-4.0, 1.0),
        (-5.0, 1.0),
    ]
    result = differential_evolution(
        loss, bounds, seed=5241495, popsize=14, maxiter=150, polish=True, workers=1
    )
    names = [
        "aspectGain",
        "migrateStart",
        "migrateEnd",
        "spokeTwist",
        "spokeWindStart",
        "spokeWindEnd",
        "foldFlatten",
        "centreBendX",
        "centreBendY",
    ]
    args.output.write_text(
        json.dumps(
            {
                "loss": result.fun,
                "throatX": throat[0],
                "throatY": throat[1],
                "aspectBase": ASPECT_BASE,
                **dict(zip(names, map(float, result.x), strict=True)),
            },
            indent=2,
        )
        + "\n"
    )
    if args.preview:
        preview = image
        overlay = Image.new("RGBA", preview.size)
        draw = ImageDraw.Draw(overlay)
        x, y, _ = points(result.x, throat)
        # Each generated path is sampled consecutively; draw it as short
        # segments so the preview exposes local drift rather than hiding it.
        cursor = 0
        for path_index, count in enumerate([96] * 13 + [72] * 52):
            coords = [
                (x[index] / VIEWBOX_WIDTH * width, y[index] / VIEWBOX_HEIGHT * height)
                for index in range(cursor, cursor + count)
            ]
            # Rings are closed curves; spokes deliberately stop at the rim.
            if path_index < 13:
                coords.append(coords[0])
            draw.line(coords, fill=(205, 252, 86, 190), width=2)
            cursor += count
        preview = Image.alpha_composite(preview.convert("RGBA"), overlay)
        preview.save(args.preview)


if __name__ == "__main__":
    main()
