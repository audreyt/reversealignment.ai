/**
 * Hero gravity field geometry.
 *
 * One camera, two runtime consumers: the server-rendered fallback particles
 * and the WebGL shader (which receives these constants as JSON and mirrors the
 * maths in GLSL). They must agree or reduced-motion and live particles diverge
 * from the cleaned reference mesh they are supposed to orbit.
 *
 * The field is a funnel drawn as a measured family of ellipses. Every ring is
 * an ellipse sharing one screen rotation; as a ring shrinks its centre follows
 * a quadratic curve from the rim's centre to the throat, which is what makes
 * the surface read as a well leaning away from the viewer rather than a flat
 * dartboard.
 *
 * The constants are fitted against the particle-free temporal median generated
 * by scripts/extract-hero-mesh.py. The rim remains pinned by its measured
 * tangents. The dark throat is measured separately by intersecting inner-spoke
 * ridge tangents; migration, curvature, aspect, fold and winding then come from
 * the reproducible stratified optimizer in scripts/fit-hero-mesh.py.
 *
 * The runtime deliberately contains no SVG wire trace. The traced preview is
 * an offline fitter diagnostic only; production uses the cleaned reference
 * raster beneath the particles.
 */

export const HERO_FIELD = {
  /** Screen rotation shared by every ring, in degrees. */
  rollDeg: -19.64,
  /** Centre of the outermost ring, in viewBox units. */
  rimX: 109.105,
  rimY: 50.675,
  /** The throat: spokes radiate from it and ring centres migrate onto it. */
  throatX: 108.58504,
  throatY: 67.50586,
  /** Semi-major axis of the outermost ring. */
  rimRadius: 58.226,
  /** Ring aspect (semi-minor / semi-major), easing rounder toward the throat. */
  aspectBase: 0.74275,
  aspectGain: 0.10263,
  /**
   * The fold: inside `foldStart` the rings flatten by up to `foldFlatten`,
   * collapsing the inner family onto a short crease along the roll axis
   * instead of onto a point. The origin's throat is exactly that — arcs merge
   * tangentially into a diagonal seam and the convergence hides along it,
   * where concentric round rings + radial spoke ends read as a bullseye
   * staring back: a bright collar around a dark pupil, the exposed
   * singularity. Spoke endpoints inherit the flattening from the pinch
   * ellipse, so they spread along the crease rather than encircling a dot.
   */
  foldStart: 0.08,
  foldFlatten: 0.9,
  /** Ring band over which the centre migrates from the rim onto the throat. */
  migrateStart: 0.44959,
  migrateEnd: 0.04,
  /**
   * Quadratic centreline bend. The 4m(1−m) basis is zero at both endpoints,
   * so it can preserve the measured rim and throat while aligning the middle.
   */
  centreBendX: 0.04245,
  centreBendY: -3.63425,
  /**
   * Smallest orbit radius; below this a particle has reached the throat. This
   * bounds particle travel only — the wireframe's inner extent is `RING_RADII`.
   */
  throatRadius: 0.055,
  /** First projected core encounter starts a one-way fade for that lifecycle. */
  throatFadeRadius: 4,
  /** Maximum fade time; late encounters shorten it so opacity reaches zero before wrap. */
  throatFadeSeconds: 0.45,
  throatFadeSearchStart: 0.55,
  throatFadeSearchSteps: 720,
  /**
   * Angular acceleration measured from 5,495 frame-to-frame particle tracks
   * after recentering them on the corrected throat.
   * ω = velocity / radius^angularExponent.
   */
  angularExponent: 0.125,
  /**
   * Keep the particle-only projected ellipse safely around the throat. Rings
   * already enclosing it remain untouched; only the overhanging middle band
   * is translated enough to admit every screen bearing.
   */
  particleOriginMargin: 0.98,
  /** Near/far size cue: how much bigger a particle gets on the near side. */
  nearGain: 0.24,
  /**
   * Fraction of a particle's sprite taken up by the solid ball. The thin
   * remainder is the light it throws onto the mesh — a tight rim, not a bloom:
   * the reference balls are near-matte, so a wide halo makes dense clusters
   * merge into patches of light the origin does not have. Shared so the
   * server-rendered fallback circles and the shader cannot disagree.
   */
  ballFraction: 0.65,
  /**
   * Spoke winding: a spoke is a curve of constant ellipse parameter θ across
   * all rings, and it winds further as the ring centres migrate. The fitted
   * winding stays quiet at the rim and accumulates through the mid-field.
   *   wind(ring) = spokeTwist × smooth(clamp01((windStart − ring) / (windStart − windEnd)))
   */
  spokeTwist: -0.29864,
  spokeWindStart: 0.57402,
  spokeWindEnd: 0.01,
} as const;

/** Motion ranges fitted from frame-to-frame tracks in the 8.6-second reference loop. */
export const HERO_PARTICLE_MOTION = {
  durationMin: 20,
  durationRange: 70,
  durationPower: 2,
  velocityMin: 0.14,
  velocityRange: 0.11,
} as const;

/**
 * Where the rings sit, as a fraction of the rim radius.
 *
 * The reference funnel has 13 rings with approximately even spacing in
 * projected screen-space. An evenly-spaced parameter ladder (1/13 … 13/13)
 * maps to slightly uneven projected radii because the aspect and migration
 * functions are nonlinear, but the result closely tracks the measured
 * reference ring positions from family2.json (3.1, 7.9, 11.8 … 58.2 vb).
 *
 * The earlier 20-rung ladder added 9 measured inner rungs to close a hole at
 * the throat, but those rungs landed ~1 vb apart inside 10 vb and packed the
 * core far more densely than the reference — creating a bright inner cluster
 * and making the throat the dominant landmark. The fold-fade mask handles the
 * throat without needing the crowded inner rungs.
 */
export const RING_RADII = [
  1 / 13,
  2 / 13,
  3 / 13,
  4 / 13,
  5 / 13,
  6 / 13,
  7 / 13,
  8 / 13,
  9 / 13,
  10 / 13,
  11 / 13,
  12 / 13,
  1,
] as const;

/**
 * Where the spokes stop on their way in, as a fraction of the rim radius.
 *
 * Not zero: strokes meeting at one exact point composite into a bright dot.
 * Not wider either: 0.012 was tried to spread the endpoints along the crease
 * and it re-opened the pupil — 100% black inside 0.25vb where the reference
 * has 1%, because nothing else puts ink at the very centre. What actually
 * removes the focal-point read is the one-sided core in the component (ring
 * arcs plus occluded far-side spoke tails), not endpoint spread: only the
 * near-side fan arrives, and the fold-fade mask dims its merge.
 */
export const SPOKE_PINCH = 0.002;

export type FieldPoint = {
  /** Projected viewBox coordinates. */
  x: number;
  y: number;
  /** Depth cue: positive on the near side of the orbit, negative on the far. */
  depth: number;
  /** Size multiplier, 1 on the orbit's flanks. */
  scale: number;
};

const smooth = (amount: number) => amount * amount * (3 - 2 * amount);
const lerp = (start: number, end: number, amount: number) => start + (end - start) * amount;

/** Semi-minor over semi-major for a ring, flattening into the core fold. */
const ringAspect = (ring: number): number => {
  const { aspectBase, aspectGain, foldStart, foldFlatten } = HERO_FIELD;
  const fold = smooth(Math.min(Math.max((foldStart - ring) / foldStart, 0), 1));
  return (aspectBase + aspectGain * (1 - ring)) * (1 - foldFlatten * fold);
};

/** Centre of a projected ring along the fitted quadratic migration path. */
const ringCentre = (ring: number): { x: number; y: number } => {
  const { rimX, rimY, throatX, throatY } = HERO_FIELD;
  const { migrateStart, migrateEnd, centreBendX, centreBendY } = HERO_FIELD;
  const ramp = Math.min(Math.max((migrateStart - ring) / (migrateStart - migrateEnd), 0), 1);
  const migrate = smooth(ramp);
  const curve = 4 * migrate * (1 - migrate);
  return {
    x: lerp(rimX, throatX, migrate) + centreBendX * curve,
    y: lerp(rimY, throatY, migrate) + centreBendY * curve,
  };
};

/**
 * Project a point on the funnel into viewBox space.
 *
 * `radius` selects a ring (0 at the throat, 1 at the rim) and `angle` is its
 * ellipse parameter. This is the fitted mesh surface; particle motion uses
 * `particlePoint` so its screen bearing cannot reverse in the overhang.
 */
export function fieldPoint(radius: number, angle: number): FieldPoint {
  const { rollDeg, throatX, throatY, rimRadius, nearGain } = HERO_FIELD;

  const ring = Math.min(Math.max(radius, 0), 1);
  const depth = Math.sin(angle);
  const scale = 1 + nearGain * depth;

  const semiMajor = rimRadius * ring;
  if (semiMajor < 1e-6) return { x: throatX, y: throatY, depth, scale };

  const centre = ringCentre(ring);
  const semiMinor = semiMajor * ringAspect(ring);
  const roll = (rollDeg * Math.PI) / 180;
  const cosRoll = Math.cos(roll);
  const sinRoll = Math.sin(roll);
  const localX = semiMajor * Math.cos(angle);
  const localY = semiMinor * Math.sin(angle);

  return {
    x: centre.x + localX * cosRoll - localY * sinRoll,
    y: centre.y + localX * sinRoll + localY * cosRoll,
    depth,
    scale,
  };
}

/**
 * Project a particle from a screen-space bearing around the measured throat.
 *
 * The fitted middle rings lean far enough that the throat sits outside some
 * of their projected ellipses. Using the ellipse parameter as an orbit angle
 * can therefore make an inward-moving particle briefly reverse on screen.
 * Particles instead use the fitted ring unless it excludes the throat; only
 * then is its centre translated just enough to contain it. A ray from the
 * throat can consequently reach every bearing, while the fitted rim remains
 * exact and a decreasing bearing is unambiguously counterclockwise in y-down
 * space.
 */
export function particlePoint(radius: number, bearing: number): FieldPoint {
  const { rollDeg, throatX, throatY, rimRadius } = HERO_FIELD;
  const { nearGain, particleOriginMargin } = HERO_FIELD;
  const ring = Math.min(Math.max(radius, 0), 1);
  if (ring < 1e-6) {
    const depth = Math.sin(bearing);
    return { x: throatX, y: throatY, depth, scale: 1 + nearGain * depth };
  }

  const roll = (rollDeg * Math.PI) / 180;
  const cosRoll = Math.cos(roll);
  const sinRoll = Math.sin(roll);
  const directionX = Math.cos(bearing);
  const directionY = Math.sin(bearing);
  const centre = ringCentre(ring);
  const semiMajor = rimRadius * ring;
  const semiMinor = semiMajor * ringAspect(ring);
  const offsetX = throatX - centre.x;
  const offsetY = throatY - centre.y;
  let localX = offsetX * cosRoll + offsetY * sinRoll;
  let localY = -offsetX * sinRoll + offsetY * cosRoll;
  const normalizedOffset = Math.hypot(localX / semiMajor, localY / semiMinor);
  const originScale =
    normalizedOffset > particleOriginMargin ? particleOriginMargin / normalizedOffset : 1;
  localX *= originScale;
  localY *= originScale;
  const rayX = directionX * cosRoll + directionY * sinRoll;
  const rayY = -directionX * sinRoll + directionY * cosRoll;
  const inverseMajor = 1 / (semiMajor * semiMajor);
  const inverseMinor = 1 / (semiMinor * semiMinor);
  const quadraticA = rayX * rayX * inverseMajor + rayY * rayY * inverseMinor;
  const quadraticB = 2 * (localX * rayX * inverseMajor + localY * rayY * inverseMinor);
  const quadraticC = localX * localX * inverseMajor + localY * localY * inverseMinor - 1;
  const reach =
    (-quadraticB + Math.sqrt(quadraticB * quadraticB - 4 * quadraticA * quadraticC)) /
    (2 * quadraticA);
  const depth = Math.min(Math.max((localY + reach * rayY) / semiMinor, -1), 1);

  return {
    x: throatX + directionX * reach,
    y: throatY + directionY * reach,
    depth,
    scale: 1 + nearGain * depth,
  };
}

/**
 * A point on the funnel's spoke at ellipse parameter `theta`, for the ring at
 * `radius`. Unlike `fieldPoint`, this uses the parametric form of each ring's
 * ellipse rather than a ray from the throat. Because ring centres migrate as
 * the funnel narrows, a constant-theta path across rings is a curve, matching
 * the reference image. `spokeTwist` over the `spokeWindStart..spokeWindEnd`
 * band adds the measured winding on top — see HERO_FIELD.
 */
export function spokePointAt(radius: number, theta: number): FieldPoint {
  const { rollDeg, throatX, throatY, rimRadius } = HERO_FIELD;
  const { nearGain, spokeTwist, spokeWindStart, spokeWindEnd } = HERO_FIELD;

  const ring = Math.min(Math.max(radius, 0), 1);

  // The measured wind: nothing outside the band, saturated inside it.
  const wind = smooth(
    Math.min(Math.max((spokeWindStart - ring) / (spokeWindStart - spokeWindEnd), 0), 1)
  );
  const t = theta + spokeTwist * wind;

  const semiMajor = rimRadius * ring;
  if (semiMajor < 1e-6) return { x: throatX, y: throatY, depth: Math.sin(theta), scale: 1 };

  const centre = ringCentre(ring);
  const semiMinor = semiMajor * ringAspect(ring);

  const roll = (rollDeg * Math.PI) / 180;
  const cosRoll = Math.cos(roll);
  const sinRoll = Math.sin(roll);
  const ct = Math.cos(t);
  const st = Math.sin(t);

  const x = centre.x + semiMajor * ct * cosRoll - semiMinor * st * sinRoll;
  const y = centre.y + semiMajor * ct * sinRoll + semiMinor * st * cosRoll;

  // Depth and scale follow the original angle so the visual weight of the
  // near half matches the rings.
  const depth = Math.sin(theta);
  const scale = 1 + nearGain * depth;

  return { x, y, depth, scale };
}

/**
 * Orbit radius over a particle's life: a quick fling outward, two long inward
 * sweeps, then a fast final drop into the throat.
 */
export function radiusAtProgress(radiusStart: number, progress: number): number {
  if (progress < 0.225) return lerp(radiusStart, 0.8, smooth(progress / 0.225));
  if (progress < 0.575) return lerp(0.8, 0.55, smooth((progress - 0.225) / 0.35));
  if (progress < 0.925) return lerp(0.55, 0.25, smooth((progress - 0.575) / 0.35));
  return lerp(0.25, HERO_FIELD.throatRadius, smooth((progress - 0.925) / 0.075));
}

/** Integration steps for angular travel; the shader uses the same count. */
export const INTEGRATION_STEPS = 48;

/**
 * Angle swept by a particle up to `progress`. Angular speed rises as the radius
 * shrinks, so the integral is accumulated numerically — the shader runs the
 * identical loop so live and pre-rendered positions match.
 */
export function angularTravelAtProgress(
  radiusStart: number,
  duration: number,
  velocity: number,
  progress: number
): number {
  const stepSize = progress / INTEGRATION_STEPS;
  let travel = 0;
  for (let step = 0; step < INTEGRATION_STEPS; step += 1) {
    const sampleProgress = (step + 0.5) * stepSize;
    const radius = radiusAtProgress(radiusStart, sampleProgress);
    travel +=
      velocity *
      Math.pow(1 / Math.max(radius, 0.08), HERO_FIELD.angularExponent) *
      duration *
      stepSize;
  }
  return travel;
}

/** Locate the first on-screen throat encounter and latch it for the rest of the lifecycle. */
export function throatEncounterProgress(
  radiusStart: number,
  duration: number,
  velocity: number,
  angleStart: number
): number {
  const { throatFadeRadius, throatFadeSearchStart, throatFadeSearchSteps } = HERO_FIELD;
  const distanceAt = (progress: number) => {
    const radius = radiusAtProgress(radiusStart, progress);
    const angle = angleStart - angularTravelAtProgress(radiusStart, duration, velocity, progress);
    const point = particlePoint(radius, angle);
    return Math.hypot(point.x - HERO_FIELD.throatX, point.y - HERO_FIELD.throatY);
  };

  let previous: number = throatFadeSearchStart;
  if (distanceAt(previous) <= throatFadeRadius) return previous;
  for (let step = 1; step <= throatFadeSearchSteps; step += 1) {
    const progress =
      throatFadeSearchStart + (step / throatFadeSearchSteps) * (1 - throatFadeSearchStart);
    if (distanceAt(progress) <= throatFadeRadius) {
      let outside = previous;
      let inside = progress;
      for (let refinement = 0; refinement < 14; refinement += 1) {
        const midpoint = (outside + inside) / 2;
        if (distanceAt(midpoint) <= throatFadeRadius) inside = midpoint;
        else outside = midpoint;
      }
      return inside;
    }
    previous = progress;
  }
  return 1;
}

/** Fade in at birth, then rapidly and monotonically after the first throat encounter. */
export function opacityAtProgress(
  opacity: number,
  progress: number,
  fadeStart: number,
  duration: number
): number {
  const birthFade = Math.min(Math.max(progress / 0.04, 0), 1);
  const fadeSeconds = Math.max(
    1e-6,
    Math.min(HERO_FIELD.throatFadeSeconds, (1 - fadeStart) * duration)
  );
  const throatFade =
    progress <= fadeStart ? 1 : 1 - ((progress - fadeStart) * duration) / fadeSeconds;
  return opacity * birthFade * Math.min(Math.max(throatFade, 0), 1);
}
