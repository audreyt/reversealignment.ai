import { describe, expect, test } from 'vite-plus/test';
import { isEventExpired, upcomingEvents } from '../../src/lib/events';
import { getContent, listLocales } from '../../src/lib/i18n';
import type { CoalitionEvent } from '../../src/lib/types';

const SALON_ID = 'rxc-salon-2026-08';
const SALON_URL = 'https://luma.com/8fap6goj';
const SALON_START = '2026-08-24T20:00:00.000Z';
const SALON_END = '2026-08-24T21:00:00.000Z';

function event(overrides: Partial<CoalitionEvent> = {}): CoalitionEvent {
  return {
    id: 'fixture',
    startsAt: '2026-08-24T20:00:00.000Z',
    endsAt: '2026-08-24T21:00:00.000Z',
    when: 'fixture when',
    title: 'fixture title',
    body: 'fixture body',
    cta: { label: 'Register', href: SALON_URL, external: true },
    ...overrides,
  };
}

describe('upcomingEvents', () => {
  test('keeps events whose endsAt is still in the future', () => {
    const open = event({ id: 'open', endsAt: '2026-08-24T21:00:00.000Z' });
    const kept = upcomingEvents([open], new Date('2026-08-24T20:59:59.999Z'));
    expect(kept.map((item) => item.id)).toEqual(['open']);
  });

  test('keeps an event exactly at endsAt', () => {
    const boundary = event({ id: 'boundary', endsAt: '2026-08-24T21:00:00.000Z' });
    const kept = upcomingEvents([boundary], new Date('2026-08-24T21:00:00.000Z'));
    expect(kept.map((item) => item.id)).toEqual(['boundary']);
  });

  test('drops events whose endsAt has passed', () => {
    const past = event({ id: 'past', endsAt: '2026-08-24T21:00:00.000Z' });
    const kept = upcomingEvents([past], new Date('2026-08-24T21:00:00.001Z'));
    expect(kept).toEqual([]);
  });

  test('filters a mixed list without reordering survivors', () => {
    const first = event({ id: 'first', endsAt: '2026-09-01T00:00:00.000Z' });
    const second = event({ id: 'second', endsAt: '2026-08-01T00:00:00.000Z' });
    const third = event({ id: 'third', endsAt: '2026-10-01T00:00:00.000Z' });
    const kept = upcomingEvents([first, second, third], new Date('2026-08-15T00:00:00.000Z'));
    expect(kept.map((item) => item.id)).toEqual(['first', 'third']);
  });

  test('defaults the clock to now when no clock is passed', () => {
    const farFuture = event({
      id: 'far',
      startsAt: '2099-01-01T00:00:00.000Z',
      endsAt: '2099-01-02T00:00:00.000Z',
    });
    const farPast = event({
      id: 'gone',
      startsAt: '2000-01-01T00:00:00.000Z',
      endsAt: '2000-01-02T00:00:00.000Z',
    });
    expect(upcomingEvents([farFuture, farPast]).map((item) => item.id)).toEqual(['far']);
  });

  test('throws on an unparseable endsAt so bad content fails the build', () => {
    expect(() =>
      upcomingEvents([event({ endsAt: 'not-a-date' })], new Date('2026-08-01T00:00:00.000Z'))
    ).toThrow(/invalid endsAt/);
  });

  test('throws on an unparseable startsAt so bad content fails the build', () => {
    expect(() =>
      upcomingEvents([event({ startsAt: 'also-bad' })], new Date('2026-08-01T00:00:00.000Z'))
    ).toThrow(/invalid startsAt/);
  });
});

describe('coalition salon catalog', () => {
  test('ships one RxC salon with identical url and start across every locale', () => {
    const locales = listLocales();
    expect(locales.length).toBeGreaterThanOrEqual(5);

    for (const locale of locales) {
      const { events, eventsTitle } = getContent(locale).coalition;
      expect(eventsTitle.length, locale).toBeGreaterThan(0);
      expect(events, locale).toHaveLength(1);

      const salon = events[0];
      expect(salon.id, locale).toBe(SALON_ID);
      expect(salon.startsAt, locale).toBe(SALON_START);
      expect(salon.endsAt, locale).toBe(SALON_END);
      expect(salon.cta.href, locale).toBe(SALON_URL);
      expect(salon.cta.external, locale).toBe(true);
      expect(salon.cta.label.length, locale).toBeGreaterThan(0);
      expect(salon.title.length, locale).toBeGreaterThan(0);
      expect(salon.body.length, locale).toBeGreaterThan(0);
      expect(salon.when.length, locale).toBeGreaterThan(0);
      expect(Number.isNaN(Date.parse(salon.startsAt)), locale).toBe(false);
      expect(Number.isNaN(Date.parse(salon.endsAt)), locale).toBe(false);
      expect(Date.parse(salon.endsAt), locale).toBeGreaterThan(Date.parse(salon.startsAt));
    }

    // Identity across locales is the standing localization rule: translate
    // labels, never the destination or the machine-readable instant.
    const urls = new Set(locales.map((locale) => getContent(locale).coalition.events[0].cta.href));
    const starts = new Set(
      locales.map((locale) => getContent(locale).coalition.events[0].startsAt)
    );
    const ends = new Set(locales.map((locale) => getContent(locale).coalition.events[0].endsAt));
    expect(urls).toEqual(new Set([SALON_URL]));
    expect(starts).toEqual(new Set([SALON_START]));
    expect(ends).toEqual(new Set([SALON_END]));
  });

  test('still lists the salon before it ends and drops it afterward', () => {
    const events = getContent('en').coalition.events;
    expect(upcomingEvents(events, new Date('2026-08-24T20:59:59.000Z'))).toHaveLength(1);
    expect(upcomingEvents(events, new Date(SALON_END))).toHaveLength(1);
    expect(upcomingEvents(events, new Date('2026-08-24T21:00:00.001Z'))).toHaveLength(0);
  });
});

describe('isEventExpired', () => {
  test('reports an event over once endsAt has passed', () => {
    expect(isEventExpired('2026-08-24T21:00:00.000Z', new Date('2026-08-24T21:00:00.001Z'))).toBe(
      true
    );
  });

  test('keeps an event exactly at endsAt', () => {
    expect(isEventExpired('2026-08-24T21:00:00.000Z', new Date('2026-08-24T21:00:00.000Z'))).toBe(
      false
    );
  });

  test('keeps an event still to come', () => {
    expect(isEventExpired('2026-08-24T21:00:00.000Z', new Date('2026-08-01T00:00:00.000Z'))).toBe(
      false
    );
  });

  test('fails open on an unparseable instant rather than hiding real content', () => {
    expect(isEventExpired('not-a-date', new Date('2026-08-24T21:00:00.001Z'))).toBe(false);
  });

  test('defaults the clock to now when no clock is passed', () => {
    expect(isEventExpired('2000-01-01T00:00:00.000Z')).toBe(true);
    expect(isEventExpired('2099-01-01T00:00:00.000Z')).toBe(false);
  });

  test('agrees with the build-time filter on the shipped salon', () => {
    const salon = getContent('en').coalition.events[0];
    const beforeEnd = new Date('2026-08-24T20:30:00.000Z');
    const afterEnd = new Date('2026-08-24T21:00:00.001Z');
    expect(isEventExpired(salon.endsAt, beforeEnd)).toBe(false);
    expect(upcomingEvents([salon], beforeEnd)).toHaveLength(1);
    expect(isEventExpired(salon.endsAt, afterEnd)).toBe(true);
    expect(upcomingEvents([salon], afterEnd)).toHaveLength(0);
  });
});
