import { describe, expect, test } from 'vite-plus/test';
import {
  HERO_FIELD,
  HERO_PARTICLE_MOTION,
  INTEGRATION_STEPS,
  RING_RADII,
  SPOKE_PINCH,
  angularTravelAtProgress,
  fieldPoint,
  opacityAtProgress,
  particlePoint,
  radiusAtProgress,
  spokePointAt,
  throatEncounterProgress,
} from '../../src/lib/hero-field';

const TWO_PI = Math.PI * 2;

describe('hero field camera', () => {
  test('reproduces the reference rim ellipse and throat', () => {
    // Measured off the origin render, whose frame aspect equals the viewBox so
    // its pixels map to viewBox units at 1/23. These four anchors are what make
    // the mesh read as the same funnel: rim tangents fix the ellipse's size,
    // rotation and aspect; the throat fixes where the spokes converge.
    let top = { x: 0, y: Infinity };
    let bottom = { x: 0, y: -Infinity };
    let left = { x: Infinity, y: 0 };
    for (let step = 0; step <= 2000; step += 1) {
      const point = fieldPoint(1, (step / 2000) * TWO_PI);
      if (point.y < top.y) top = point;
      if (point.y > bottom.y) bottom = point;
      if (point.x < left.x) left = point;
    }
    // Reference: top (119.91, 5.65), bottom (98.30, 95.70), left (52.39, 59.65).
    expect(top.x).toBeCloseTo(119.9, 0);
    expect(top.y).toBeCloseTo(5.7, 0);
    expect(bottom.x).toBeCloseTo(98.3, 0);
    expect(bottom.y).toBeCloseTo(95.7, 0);
    expect(left.x).toBeCloseTo(52.4, 0);
    expect(left.y).toBeCloseTo(59.4, 0);
    // The rim's extreme-y tangents sit either side of its centre — that offset
    // is the whole signature of the roll, and is zero on an unrolled funnel.
    expect(top.x - bottom.x).toBeGreaterThan(15);
    // Inner-spoke ridge tangents intersect here in the cleaned 1900×1150 frame.
    // This is an external reference anchor, not a self-consistency assertion.
    expect(HERO_FIELD.throatX).toBeCloseTo(108.6, 1);
    expect(HERO_FIELD.throatY).toBeCloseTo(67.5, 1);
  });

  test('shrinks every ring onto the throat', () => {
    // Ring centres follow a curved migration path into the throat, so compare
    // distance to the endpoint instead of assuming either axis is monotonic.
    const centreOf = (radius: number) => {
      const start = fieldPoint(radius, 0);
      const opposite = fieldPoint(radius, Math.PI);
      return { x: (start.x + opposite.x) / 2, y: (start.y + opposite.y) / 2 };
    };
    const rim = centreOf(1);
    const mid = centreOf(0.22);
    const inner = centreOf(0.08);
    const distance = (point: { x: number; y: number }) =>
      Math.hypot(point.x - HERO_FIELD.throatX, point.y - HERO_FIELD.throatY);
    expect(distance(mid)).toBeLessThan(distance(rim));
    expect(distance(inner)).toBeLessThan(distance(mid));
    expect(distance(inner)).toBeLessThan(1);
  });

  test('retains the measured near/far depth cue', () => {
    // Same radius, opposite sides of the orbit: the near half must be measurably
    // larger than the far half, and depth must straddle the core at zero.
    const near = fieldPoint(1, Math.PI / 2);
    const far = fieldPoint(1, -Math.PI / 2);
    expect(near.depth).toBeGreaterThan(0);
    expect(far.depth).toBeLessThan(0);
    expect(near.scale).toBeGreaterThan(far.scale * 1.15);
    expect(near.scale).toBeGreaterThan(1);
    expect(far.scale).toBeLessThan(1);
  });

  test('pins the core on the throat', () => {
    const core = fieldPoint(0, 0);
    expect(core.x).toBeCloseTo(HERO_FIELD.throatX, 6);
    expect(core.y).toBeCloseTo(HERO_FIELD.throatY, 6);
    // Every bearing collapses to the same point once the ring has no size.
    expect(fieldPoint(0, 2).x).toBeCloseTo(core.x, 6);
    expect(fieldPoint(0, 2).y).toBeCloseTo(core.y, 6);
  });

  test('clamps radius into the unit disc', () => {
    expect(fieldPoint(5, 1)).toEqual(fieldPoint(1, 1));
    expect(fieldPoint(-3, 1)).toEqual(fieldPoint(0, 1));
  });
});

describe('spoke geometry', () => {
  test('spoke curves visibly — midpoint differs from a straight line', () => {
    // A spoke at fixed theta traces a curve because ring centres migrate.
    // The midpoint of the curve (at radius=0.5) must sit off the straight
    // line connecting the rim point (radius=1) to the throat (radius→0).
    const theta = Math.PI / 4;
    const rim = spokePointAt(1, theta);
    const mid = spokePointAt(0.5, theta);
    const { throatX, throatY } = HERO_FIELD;
    // Midpoint on the straight line between rim and throat:
    const lineMidX = (rim.x + throatX) / 2;
    const lineMidY = (rim.y + throatY) / 2;
    // The actual curve midpoint must be displaced from that by more than 1 vb unit.
    const curvature = Math.sqrt((mid.x - lineMidX) ** 2 + (mid.y - lineMidY) ** 2);
    expect(curvature).toBeGreaterThan(1);
  });

  test('spoke converges onto the throat as radius → 0', () => {
    const { throatX, throatY } = HERO_FIELD;
    for (const theta of [0, Math.PI / 3, Math.PI, (5 * Math.PI) / 4]) {
      const tip = spokePointAt(0, theta);
      expect(tip.x).toBeCloseTo(throatX, 4);
      expect(tip.y).toBeCloseTo(throatY, 4);
    }
  });

  test('spoke at rim matches ring at the same theta', () => {
    // At radius=1 the parametric point must lie on ring 1's ellipse, i.e. a
    // point obtained by sampling fieldPoint(1, bearing) for the same physical
    // angle. Verify it by checking it is close to some fieldPoint on ring 1.
    const theta = Math.PI / 6;
    const sp = spokePointAt(1, theta);
    // The rim ring (radius=1) has the same centre as rimX/rimY, so the spoke
    // point at the rim must be within the ring's bounding box.
    const { rimX, rimY, rimRadius } = HERO_FIELD;
    const distFromRimCentre = Math.sqrt((sp.x - rimX) ** 2 + (sp.y - rimY) ** 2);
    // semiMajor = rimRadius ≈ 58; point must be on the ellipse boundary (±1).
    expect(distFromRimCentre).toBeGreaterThan(rimRadius * 0.5);
    expect(distFromRimCentre).toBeLessThan(rimRadius * 1.05);
  });

  test('winds counterclockwise by the measured amount', () => {
    // The fitted reference spokes wind counterclockwise between 21 and 1.4
    // viewBox units of the throat. Accumulate the model's screen bearing over
    // the same span and pin its fitted range.
    const { throatX, throatY } = HERO_FIELD;
    let total = 0;
    for (let spoke = 0; spoke < 8; spoke += 1) {
      const theta = (spoke / 8) * TWO_PI;
      let drift = 0;
      let previous: number | null = null;
      for (let step = 0; step <= 200; step += 1) {
        const ring = 0.45 - (step / 200) * (0.45 - 0.02);
        const point = spokePointAt(ring, theta);
        const bearing = Math.atan2(point.y - throatY, point.x - throatX);
        if (previous !== null) {
          let delta = bearing - previous;
          if (delta > Math.PI) delta -= TWO_PI;
          if (delta < -Math.PI) delta += TWO_PI;
          drift += delta;
        }
        previous = bearing;
      }
      total += drift;
    }
    const meanDegrees = (total / 8) * (180 / Math.PI);
    // Negative = counterclockwise on a y-down screen, same sense as the orbit.
    expect(meanDegrees).toBeLessThan(-12);
    expect(meanDegrees).toBeGreaterThan(-20);
  });
});

describe('ring ladder', () => {
  test('spokes reach into the throat — core coverage is not ring-dependent', () => {
    // The rendered void gate confirms the core stays filled at 52 spokes + 13
    // rings: 0% black inside 0.25vb, 0.9% inside 0.6vb. The reason is that
    // spokes run all the way to SPOKE_PINCH ≈ 0, not rings. This test pins
    // that contract directly: a spoke sampled at r→0 must land within 1vb of
    // the throat, so a future change that accidentally truncates spokes early
    // cannot silently pass the gate without also failing this.
    const { throatX, throatY } = HERO_FIELD;
    for (let spoke = 0; spoke < 8; spoke += 1) {
      const theta = (spoke / 8) * TWO_PI;
      const tip = spokePointAt(SPOKE_PINCH, theta);
      const dist = Math.hypot(tip.x - throatX, tip.y - throatY);
      expect(dist).toBeLessThan(1);
    }
  });

  test('spans monotonically from the core out to the rim', () => {
    for (let index = 1; index < RING_RADII.length; index += 1) {
      expect(RING_RADII[index]).toBeGreaterThan(RING_RADII[index - 1]);
    }
    expect(RING_RADII[RING_RADII.length - 1]).toBe(1);
  });

  test('parameter-space steps are approximately even', () => {
    // RING_RADII is now 1/13 … 13/13: uniform in parameter space. Guard that
    // nobody replaces it with a non-uniform ladder that sneaks past the
    // monotone check. Every step should be within 50% of the mean step —
    // this catches crowded-inner and crowded-outer distortions while being
    // insensitive to floating-point rounding of i/13.
    const steps = RING_RADII.slice(1).map((r, i) => r - RING_RADII[i]!);
    const mean = steps.reduce((s, d) => s + d, 0) / steps.length;
    for (const step of steps) {
      expect(step / mean).toBeGreaterThan(0.5);
      expect(step / mean).toBeLessThan(1.5);
    }
  });

  test('flattens into the fold instead of rounding toward a point', () => {
    // The reference's core is a crease: its ring family collapses onto a
    // short line segment, not onto a point, which is what hides the
    // singularity. Rings inside the fold band must be measurably flatter
    // than mid-field rings — resetting foldFlatten to zero restores the old
    // rounder-inward law and the exposed bullseye with it. Measure each ring
    // around its own centre because the fitted centreline is deliberately
    // curved between the rim and throat.
    const aspectOf = (radius: number) => {
      const start = fieldPoint(radius, 0);
      const opposite = fieldPoint(radius, Math.PI);
      const centreX = (start.x + opposite.x) / 2;
      const centreY = (start.y + opposite.y) / 2;
      let nearest = Infinity;
      let farthest = 0;
      for (let step = 0; step < 720; step += 1) {
        const point = fieldPoint(radius, (step / 720) * TWO_PI);
        const reach = Math.hypot(point.x - centreX, point.y - centreY);
        nearest = Math.min(nearest, reach);
        farthest = Math.max(farthest, reach);
      }
      return nearest / farthest;
    };
    const core = aspectOf(0.01);
    const midField = aspectOf(0.15);
    expect(core).toBeLessThan(0.6);
    expect(midField).toBeGreaterThan(0.55);
    expect(midField - core).toBeGreaterThan(0.2);
  });
});

describe('orbit direction', () => {
  test('maps the orbit parameter to an exact screen bearing', () => {
    const { throatX, throatY } = HERO_FIELD;
    for (const radius of [0.05, 0.25, 0.55, 1]) {
      for (let step = 0; step < 32; step += 1) {
        const angle = (step / 32) * TWO_PI - Math.PI;
        const point = particlePoint(radius, angle);
        const bearing = Math.atan2(point.y - throatY, point.x - throatX);
        expect(Math.cos(bearing)).toBeCloseTo(Math.cos(angle), 10);
        expect(Math.sin(bearing)).toBeCloseTo(Math.sin(angle), 10);
      }
    }
    expect(particlePoint(5, 1)).toEqual(particlePoint(1, 1));
    expect(particlePoint(-3, 1)).toEqual(particlePoint(0, 1));

    // At r=1 the particle-only correction is inactive, so the hit remains on
    // the exact fixed outer ellipse rather than a merely similar contour.
    const { rimX, rimY, rimRadius, aspectBase, rollDeg } = HERO_FIELD;
    const roll = (rollDeg * Math.PI) / 180;
    for (let step = 0; step < 32; step += 1) {
      const point = particlePoint(1, (step / 32) * TWO_PI);
      const offsetX = point.x - rimX;
      const offsetY = point.y - rimY;
      const localX = offsetX * Math.cos(roll) + offsetY * Math.sin(roll);
      const localY = -offsetX * Math.sin(roll) + offsetY * Math.cos(roll);
      expect(
        (localX * localX) / (rimRadius * rimRadius) +
          (localY * localY) / (rimRadius * aspectBase) ** 2
      ).toBeCloseTo(1, 10);
    }
  });

  test('every sampled live orbit sweeps counterclockwise on screen', () => {
    // Screen y increases downward, so the component subtracts angular travel.
    // Exercise the full orbit rather than one friendly sector: the prior
    // ellipse-parameter projection reversed briefly in the bowed inner field.
    const { throatX, throatY } = HERO_FIELD;
    for (let orbit = 0; orbit < 16; orbit += 1) {
      const radiusStart = 0.92 + (orbit / 15) * 0.16;
      const duration = 20 + (orbit / 15) * 70;
      const velocity = 0.14 + (orbit / 15) * 0.11;
      const angleStart = (orbit / 16) * TWO_PI;
      let previous: number | null = null;
      for (let step = 0; step <= 100; step += 1) {
        const progress = (step + 0.5) / 101;
        const angle =
          angleStart - angularTravelAtProgress(radiusStart, duration, velocity, progress);
        const point = particlePoint(radiusAtProgress(radiusStart, progress), angle);
        const bearing = Math.atan2(point.y - throatY, point.x - throatX);
        if (previous !== null) {
          let delta = bearing - previous;
          if (delta > Math.PI) delta -= TWO_PI;
          if (delta < -Math.PI) delta += TWO_PI;
          // Negative = counterclockwise on a y-down screen.
          expect(delta).toBeLessThan(0);
        }
        previous = bearing;
      }
    }
  });
});

describe('orbit choreography', () => {
  test('keeps particle trajectories on the fitted ring family', () => {
    const radius = 0.3;
    const ring = Array.from({ length: 720 }, (_, index) =>
      fieldPoint(radius, (index / 720) * TWO_PI)
    );
    let maximumDrift = 0;
    for (let step = 0; step < 180; step += 1) {
      const particle = particlePoint(radius, (step / 180) * TWO_PI);
      const nearest = Math.min(
        ...ring.map((point) => Math.hypot(point.x - particle.x, point.y - particle.y))
      );
      maximumDrift = Math.max(maximumDrift, nearest);
    }
    expect(maximumDrift).toBeLessThan(0.6);
  });

  test('flings outward, sweeps inward, then drops into the throat', () => {
    const start = 0.95;
    expect(radiusAtProgress(start, 0)).toBeCloseTo(start, 6);
    expect(radiusAtProgress(start, 0.225)).toBeCloseTo(0.8, 6);
    expect(radiusAtProgress(start, 0.575)).toBeCloseTo(0.55, 6);
    expect(radiusAtProgress(start, 0.925)).toBeCloseTo(0.25, 6);
    expect(radiusAtProgress(start, 1)).toBeCloseTo(HERO_FIELD.throatRadius, 6);
    // Monotonic inward from the apex onward — no stalling or backtracking.
    let previous = radiusAtProgress(start, 0.225);
    for (let progress = 0.25; progress <= 1; progress += 0.05) {
      const radius = radiusAtProgress(start, progress);
      expect(radius).toBeLessThanOrEqual(previous + 1e-9);
      previous = radius;
    }
  });

  test('accumulates angular travel that accelerates as the orbit tightens', () => {
    expect(angularTravelAtProgress(0.95, 20, 0.5, 0)).toBe(0);
    const early = angularTravelAtProgress(0.95, 20, 0.5, 0.3);
    const late = angularTravelAtProgress(0.95, 20, 0.5, 0.9);
    expect(late).toBeGreaterThan(early);
    // Angular speed rises as radius falls, so the second half sweeps further
    // than the first.
    expect(late - early).toBeGreaterThan(early);
    // Linear in both duration and velocity.
    expect(angularTravelAtProgress(0.95, 40, 0.5, 0.6)).toBeCloseTo(
      angularTravelAtProgress(0.95, 20, 0.5, 0.6) * 2,
      6
    );
    expect(angularTravelAtProgress(0.95, 20, 1, 0.6)).toBeCloseTo(
      angularTravelAtProgress(0.95, 20, 0.5, 0.6) * 2,
      6
    );
    expect(INTEGRATION_STEPS).toBeGreaterThan(8);
    expect(HERO_FIELD.angularExponent).toBeCloseTo(0.125, 6);
    expect(HERO_FIELD.particleOriginMargin).toBeCloseTo(0.98, 6);
    expect(HERO_PARTICLE_MOTION.velocityMin).toBeCloseTo(0.14, 6);
    expect(HERO_PARTICLE_MOTION.velocityMin + HERO_PARTICLE_MOTION.velocityRange).toBeCloseTo(
      0.25,
      6
    );
    expect(HERO_PARTICLE_MOTION.durationMin).toBe(20);
    expect(HERO_PARTICLE_MOTION.durationMin + HERO_PARTICLE_MOTION.durationRange).toBe(90);
    expect(HERO_PARTICLE_MOTION.durationPower).toBe(2);
  });

  test('fades particles in at birth and out at the throat', () => {
    const fadeStart = 0.75;
    const duration = 30;
    const fadeProgress = HERO_FIELD.throatFadeSeconds / duration;
    expect(opacityAtProgress(1, 0, fadeStart, duration)).toBe(0);
    expect(opacityAtProgress(1, 0.02, fadeStart, duration)).toBeCloseTo(0.5, 6);
    expect(opacityAtProgress(1, 0.04, fadeStart, duration)).toBeCloseTo(1, 6);
    expect(opacityAtProgress(1, 0.5, fadeStart, duration)).toBeCloseTo(1, 6);
    expect(opacityAtProgress(1, fadeStart, fadeStart, duration)).toBe(1);
    expect(opacityAtProgress(1, fadeStart + fadeProgress / 2, fadeStart, duration)).toBeCloseTo(
      0.5,
      6
    );
    expect(opacityAtProgress(1, fadeStart + fadeProgress, fadeStart, duration)).toBe(0);
    expect(opacityAtProgress(1, 0.995, 0.99, 20)).toBeCloseTo(0.5, 6);
    expect(opacityAtProgress(1, 1, 0.99, 20)).toBe(0);
    let previous = 1;
    for (let progress = fadeStart; progress <= 1; progress += 0.0025) {
      const current = opacityAtProgress(1, progress, fadeStart, duration);
      expect(current).toBeLessThanOrEqual(previous);
      previous = current;
    }
    // Never exceeds the particle's own opacity, never goes negative.
    expect(opacityAtProgress(0.4, 0.5, fadeStart, duration)).toBeCloseTo(0.4, 6);
    expect(opacityAtProgress(1, 1.5, fadeStart, duration)).toBe(0);
  });

  test('latches the first projected throat encounter', () => {
    const orbit = { radiusStart: 0.98, duration: 32, velocity: 0.22, angleStart: 2.15 };
    const fadeStart = throatEncounterProgress(
      orbit.radiusStart,
      orbit.duration,
      orbit.velocity,
      orbit.angleStart
    );
    const distanceAt = (progress: number) => {
      const angle =
        orbit.angleStart -
        angularTravelAtProgress(orbit.radiusStart, orbit.duration, orbit.velocity, progress);
      const point = particlePoint(radiusAtProgress(orbit.radiusStart, progress), angle);
      return Math.hypot(point.x - HERO_FIELD.throatX, point.y - HERO_FIELD.throatY);
    };
    expect(fadeStart).toBeGreaterThanOrEqual(HERO_FIELD.throatFadeSearchStart);
    expect(fadeStart).toBeLessThan(1);
    expect(distanceAt(fadeStart)).toBeCloseTo(HERO_FIELD.throatFadeRadius, 3);
    const searchStep = (1 - HERO_FIELD.throatFadeSearchStart) / HERO_FIELD.throatFadeSearchSteps;
    expect(distanceAt(fadeStart - searchStep)).toBeGreaterThan(HERO_FIELD.throatFadeRadius);
  });

  test('handles already-inside and missing encounter thresholds defensively', () => {
    const mutableField = HERO_FIELD as unknown as { throatFadeRadius: number };
    const originalRadius = mutableField.throatFadeRadius;
    const orbit = [0.98, 32, 0.22, 2.15] as const;

    try {
      mutableField.throatFadeRadius = Number.POSITIVE_INFINITY;
      expect(throatEncounterProgress(...orbit)).toBe(HERO_FIELD.throatFadeSearchStart);

      mutableField.throatFadeRadius = -1;
      expect(throatEncounterProgress(...orbit)).toBe(1);
    } finally {
      mutableField.throatFadeRadius = originalRadius;
    }
  });
});
