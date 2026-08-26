import { describe, expect, test } from 'vite-plus/test';
import { isEventExpired, upcomingEvents } from '../../src/lib/events';
import { getContent, listLocales } from '../../src/lib/i18n';
import type { CoalitionEvent } from '../../src/lib/types';

const SALON_ID = 'rxc-salon-2026-08';
const SALON_URL = 'https://luma.com/8fap6goj';
const SALON_START = '2026-08-24T20:00:00.000Z';
const SALON_END = '2026-08-24T21:00:00.000Z';

const PLATFORM_ID = 'platform-originals-2026-08';
const PLATFORM_LUMA_URL = 'https://luma.com/pzkyaeuz';
const PLATFORM_PAGE_HREF = 'events/you-are-here/';
const QUESTION_POOL_URL = 'https://sli.do/20260829';
const PLATFORM_START = '2026-08-29T06:00:00.000Z';
const PLATFORM_END = '2026-08-29T08:30:00.000Z';

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

describe('coalition event catalog', () => {
  test('ships the salon and the Platform Originals talk with identical url and start across every locale', () => {
    const locales = listLocales();
    expect(locales.length).toBeGreaterThanOrEqual(5);

    for (const locale of locales) {
      const { events, eventsTitle } = getContent(locale).coalition;
      expect(eventsTitle.length, locale).toBeGreaterThan(0);
      expect(events, locale).toHaveLength(2);

      const byId = Object.fromEntries(events.map((item) => [item.id, item])) as Record<
        string,
        CoalitionEvent
      >;
      const salon = byId[SALON_ID];
      const platform = byId[PLATFORM_ID];
      expect(salon, locale).toBeDefined();
      expect(platform, locale).toBeDefined();

      for (const item of [salon, platform]) {
        expect(item!.cta.label.length, locale).toBeGreaterThan(0);
        expect(item!.title.length, locale).toBeGreaterThan(0);
        expect(item!.body.length, locale).toBeGreaterThan(0);
        expect(item!.when.length, locale).toBeGreaterThan(0);
        expect(Number.isNaN(Date.parse(item!.startsAt)), locale).toBe(false);
        expect(Number.isNaN(Date.parse(item!.endsAt)), locale).toBe(false);
        expect(Date.parse(item!.endsAt), locale).toBeGreaterThan(Date.parse(item!.startsAt));
      }

      expect(salon!.startsAt, locale).toBe(SALON_START);
      expect(salon!.endsAt, locale).toBe(SALON_END);
      expect(salon!.cta.href, locale).toBe(SALON_URL);
      expect(salon!.cta.external, locale).toBe(true);
      expect(platform!.startsAt, locale).toBe(PLATFORM_START);
      expect(platform!.endsAt, locale).toBe(PLATFORM_END);
      // The Taipei talk sends readers to our own page first, which carries both
      // the room and a way in that needs no flight. The href stays
      // page-relative so the /en/ tree links inside itself instead of jumping
      // to the zh-TW apex.
      expect(platform!.cta.href, locale).toBe(PLATFORM_PAGE_HREF);
      expect(platform!.cta.external, locale).toBeUndefined();
    }

    // Identity across locales is the standing localization rule: translate
    // labels, never the destination or the machine-readable instant.
    const salonUrls = new Set(
      locales.map(
        (locale) => getContent(locale).coalition.events.find((e) => e.id === SALON_ID)!.cta.href
      )
    );
    const platformUrls = new Set(
      locales.map(
        (locale) => getContent(locale).coalition.events.find((e) => e.id === PLATFORM_ID)!.cta.href
      )
    );
    const starts = new Set(
      locales.flatMap((locale) => getContent(locale).coalition.events.map((e) => e.startsAt))
    );
    const ends = new Set(
      locales.flatMap((locale) => getContent(locale).coalition.events.map((e) => e.endsAt))
    );
    expect(salonUrls).toEqual(new Set([SALON_URL]));
    expect(platformUrls).toEqual(new Set([PLATFORM_PAGE_HREF]));
    expect(starts).toEqual(new Set([SALON_START, PLATFORM_START]));
    expect(ends).toEqual(new Set([SALON_END, PLATFORM_END]));
  });

  test('lists events in chronological order', () => {
    const events = getContent('en').coalition.events;
    expect(events.map((item) => item.id)).toEqual([SALON_ID, PLATFORM_ID]);
  });

  test('lands the Taipei talk on a page that offers a way in from anywhere', () => {
    for (const locale of listLocales()) {
      const { event, assets } = getContent(locale);
      expect(event.eventId, locale).toBe(PLATFORM_ID);

      // Luma is reachable from the page; the question pool is the path for
      // everyone who cannot get to Taipei, and it is what a non-zh-TW reader
      // meets first.
      expect(event.attend.inPerson.href, locale).toBe(PLATFORM_LUMA_URL);
      expect(event.attend.inPerson.external, locale).toBe(true);
      expect(event.attend.remote.href, locale).toBe(QUESTION_POOL_URL);
      expect(event.attend.remote.external, locale).toBe(true);
      expect(event.prep.cta.href, locale).toBe(QUESTION_POOL_URL);
      expect(event.attend.lead, locale).toBe(locale === 'zh-tw' ? 'in-person' : 'remote');

      // The five readings and the four arcs are the same editorial data in
      // every locale; only the names are translated.
      expect(
        event.archetypes.items.map((item) => item.id),
        locale
      ).toEqual(['bridgewright', 'weaver', 'craftkeeper', 'companion', 'translator']);
      // Registrations keep coming in, so a headcount printed here is wrong by
      // the time anyone reads it. Every badge on the page names a quadrant.
      for (const item of event.archetypes.items) {
        expect(item.quadrant.trim().length, `${locale} ${item.id}`).toBeGreaterThan(0);
      }
      // The glyph is the only way an arc reads as a pair rather than as one
      // repeated name, so it must exist and must not collide. It is not prose:
      // the same five marks ship in every locale.
      const glyphs = event.archetypes.items.map((item) => item.emoji);
      for (const glyph of glyphs) {
        expect(glyph.trim().length, locale).toBeGreaterThan(0);
      }
      expect(new Set(glyphs).size, locale).toBe(glyphs.length);
      expect(glyphs, locale).toEqual(getContent('en').event.archetypes.items.map((i) => i.emoji));
      expect(
        event.stats.map((stat) => stat.value),
        locale
      ).toEqual(['5', '4', '1']);
      // An arc is a pair of readings, and nothing but the pair: the label a
      // reader sees is composed from the two ids, so there is no second copy
      // of the pairing that could disagree with them.
      expect(
        event.cycles.items.map((item) => item.id),
        locale
      ).toEqual(['tool-and-uncaught', 'guilt-and-rule', 'graduation-deadline', 'right-to-refuse']);
      expect(
        event.cycles.items.map((item) => [item.from, item.to]),
        locale
      ).toEqual([
        ['bridgewright', 'companion'],
        ['craftkeeper', 'weaver'],
        ['weaver', 'companion'],
        ['bridgewright', 'craftkeeper'],
      ]);
      for (const cycle of event.cycles.items) {
        // An arc between one reading and itself is not an arc.
        expect(cycle.from, `${locale} ${cycle.id}`).not.toBe(cycle.to);
      }
      // The seeds already sit in the live pool, so the page shows the same set
      // in the same order everywhere; only the wording is translated.
      expect(
        event.prep.seeds.map((seed) => seed.id),
        locale
      ).toEqual(
        Array.from({ length: 15 }, (_, index) => `seed-${String(index + 1).padStart(2, '0')}`)
      );
      // The board is derived from these two pointers, so a typo would render an
      // unlabelled chip rather than fail loudly.
      const archetypeIds = event.archetypes.items.map((item) => item.id);
      const arcIds = event.cycles.items.map((item) => item.id);
      for (const seed of event.prep.seeds) {
        expect(archetypeIds, `${locale} ${seed.id}`).toContain(seed.archetype);
        if (seed.arc !== undefined) {
          expect(arcIds, `${locale} ${seed.id}`).toContain(seed.arc);
        }
      }
      // The page claims the pool covers the whole map. Every reading must hold
      // at least one seed, or a reader in that corner finds an empty cell.
      for (const id of archetypeIds) {
        expect(
          event.prep.seeds.filter((seed) => seed.archetype === id).length,
          `${locale} ${id}`
        ).toBeGreaterThan(0);
      }
      // An arc with only one end seeded cannot be walked: the far end is
      // supposed to be someone else's question.
      for (const id of arcIds) {
        expect(
          event.prep.seeds.filter((seed) => seed.arc === id).length,
          `${locale} ${id}`
        ).toBeGreaterThan(1);
      }
      // Listed as the two opposed axes, not clockwise round the artwork: a
      // direction is only legible next to the one it is the opposite of.
      expect(
        event.map.axes.map((axis) => axis.id),
        locale
      ).toEqual(['crowd', 'self', 'govern', 'build']);

      // Portraits and the map artwork resolve through the same asset map every
      // other page uses, so a missing key fails the build.
      expect(assets['event-archetype-map'], locale).toBeDefined();
      for (const speaker of event.speakers.items) {
        expect(assets[speaker.image], locale).toBeDefined();
      }
    }
  });

  test('translates every line of the event page, leaving no English fallback', () => {
    const locales = listLocales();
    const proseByLocale: Record<string, string[]> = {};
    for (const locale of locales) {
      const event = getContent(locale).event;
      proseByLocale[locale] = [
        event.metaTitle,
        event.metaDescription,
        event.eyebrow,
        event.title,
        event.subtitle,
        event.body,
        event.homeLabel,
        event.attend.title,
        event.attend.when,
        event.attend.venue,
        event.attend.inPerson.label,
        event.attend.remote.label,
        event.map.title,
        event.map.lead,
        event.map.imageAlt,
        event.cycles.title,
        event.speakers.title,
        ...event.speakers.items.flatMap((item) => [item.role, item.body]),
        event.prep.title,
        event.prep.cta.label,
        event.source,
        ...event.stats.map((stat) => stat.label),
        ...event.map.axes.map((axis) => axis.label),
        ...event.archetypes.items.map((item) => item.name),
        ...event.prep.steps.map((step) => step.title),
        ...event.cycles.items.map((item) => item.body),
        event.prep.seedsTitle,
        event.prep.seedsNote,
        ...event.prep.seeds.map((seed) => seed.text),
      ];
    }

    const reference = proseByLocale.en!;
    for (const locale of locales) {
      const lines = proseByLocale[locale]!;
      expect(lines.length, locale).toBe(reference.length);
      for (const line of lines) {
        expect(line.trim().length, locale).toBeGreaterThan(0);
        // Case-sensitive, and anchored on word boundaries: `/TODO/i` matches the
        // Spanish "todos" and the Portuguese "todo", so it fails real copy.
        expect(line, locale).not.toMatch(/\bTODO\b|\bFIXME\b|[Ll]orem [Ii]psum/);
      }
      if (locale === 'en') continue;
      // Every one of these lines is prose, so a line that still reads exactly
      // like the English is an untranslated fallback, not a coincidence.
      expect(
        lines.filter((line, index) => line === reference[index]),
        locale
      ).toEqual([]);
    }
  });

  test('drops each event only after its own endsAt', () => {
    const events = getContent('en').coalition.events;
    // Before the salon ends, both are listed.
    expect(upcomingEvents(events, new Date('2026-08-24T20:59:59.000Z')).map((e) => e.id)).toEqual([
      SALON_ID,
      PLATFORM_ID,
    ]);
    // After the salon ends but before the talk ends, only the talk remains.
    expect(upcomingEvents(events, new Date('2026-08-24T21:00:00.001Z')).map((e) => e.id)).toEqual([
      PLATFORM_ID,
    ]);
    // After the talk ends, nothing remains.
    expect(upcomingEvents(events, new Date('2026-08-29T08:30:00.001Z'))).toEqual([]);
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
    const salon = getContent('en').coalition.events.find((e) => e.id === SALON_ID)!;
    const beforeEnd = new Date('2026-08-24T20:30:00.000Z');
    const afterEnd = new Date('2026-08-24T21:00:00.001Z');
    expect(isEventExpired(salon.endsAt, beforeEnd)).toBe(false);
    expect(upcomingEvents([salon], beforeEnd)).toHaveLength(1);
    expect(isEventExpired(salon.endsAt, afterEnd)).toBe(true);
    expect(upcomingEvents([salon], afterEnd)).toHaveLength(0);
  });
});
