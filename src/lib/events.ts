import type { CoalitionEvent } from './types';

/**
 * Events still open at `now`. Compared against `endsAt` so a listing that
 * ends at T stays visible until the first build made after T.
 *
 * Invalid ISO instants throw at build time rather than silently dropping the
 * event — a mistyped date in content.json must fail the build, not the page.
 */
export function upcomingEvents(
  events: readonly CoalitionEvent[],
  now: Date = new Date()
): CoalitionEvent[] {
  const nowMs = now.getTime();
  return events.filter((event) => {
    const endsAtMs = Date.parse(event.endsAt);
    if (Number.isNaN(endsAtMs)) {
      throw new Error(`coalition event "${event.id}" has invalid endsAt: ${event.endsAt}`);
    }
    const startsAtMs = Date.parse(event.startsAt);
    if (Number.isNaN(startsAtMs)) {
      throw new Error(`coalition event "${event.id}" has invalid startsAt: ${event.startsAt}`);
    }
    return endsAtMs >= nowMs;
  });
}

/**
 * Client-side companion to {@link upcomingEvents}. Static HTML keeps
 * advertising an event until the next deploy, so the rendered page re-checks
 * `endsAt` in the browser and removes anything already over.
 *
 * Fails open on an unparseable instant: the build already validated the
 * catalog, so a bad value here means a hand-edited page, and hiding real
 * content is worse than showing a stale line.
 */
export function isEventExpired(endsAt: string, now: Date = new Date()): boolean {
  const endsAtMs = Date.parse(endsAt);
  if (Number.isNaN(endsAtMs)) {
    return false;
  }
  return endsAtMs < now.getTime();
}
