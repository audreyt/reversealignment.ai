import { describe, expect, test } from 'vite-plus/test';
import { isEventExpired, upcomingEvents } from '../../src/lib/events';
import { getContent, listLocales } from '../../src/lib/i18n';
import type { CoalitionEvent } from '../../src/lib/types';

const SALON_ID = 'rxc-salon-2026-08';
const SALON_URL = 'https://luma.com/8fap6goj';
const SALON_START = '2026-08-24T20:00:00.000Z';
const SALON_END = '2026-08-24T21:00:00.000Z';

const PLATFORM_ID = 'platform-originals-2026-08';
const PLATFORM_PAGE_HREF = 'events/you-are-here/';
const TRANSCRIPT_EN_URL = 'https://archive.tw/2026-08-29-platform-originals-the-other-side-of-al';
const TRANSCRIPT_ZH_URL = 'https://archive.tw/2026-08-29-platform-originals-對齊的另一面';
const PLATFORM_START = '2026-08-29T06:00:00.000Z';
const PLATFORM_END = '2026-08-29T08:30:00.000Z';
const ZH_ANCHORS = [
  's63983970',
  's63983987',
  's63984002',
  's63984053',
  's63984060',
  's63984080',
  's63984107',
  's63984140',
  's63984199',
  's63984239',
  's63984308',
];
const EN_ANCHORS = [
  's63985755',
  's63985772',
  's63985787',
  's63985833',
  's63985840',
  's63985860',
  's63985887',
  's63985921',
  's63985980',
  's63986020',
  's63986089',
];
const ZH_CHAPTERS = [
  '可逆處自由試驗；不可逆處加強驗測、問責與制度約束',
  '讓承受後果的人，也能命名風險',
  '罕見共識不是政策本身，轉譯才是治理',
  '對齊的是群體之間的關係，不是單一榜單',
  '可驗證、可替換，才有真正的退出權',
  '關懷落地為資料土壤與在地能力',
  '從角色與職銜，回到可共同維護的工具',
  '小模型、地端運算與社群自己的語言',
  '工作的價值，不等於自動驗測的高分',
  'AI 的社會位置，必須容納不可調和的世界觀',
  '責任不能在模型、廠商與智慧體鏈條裡蒸發',
];

const EN_QUOTES = [
  'So when we discuss AI governance internationally, what we are really doing is naming which harms are irreversible, and then fitting institutions around those.',
  'The simplest method is this: any output from a model that nobody has vouched for, that carries no digital signature, you treat as fake. You invert the default.',
  'So the simplest thing to do at the outset is to have the saddle and the horse made by two different companies. That solves it.',
  'How odd. Why not just ride the horse? Why race it?',
];
const EN_MOTTOS = [
  'Mine has always been good enough ancestor, a “good enough ancestor.”',
  'If you cannot help others, at least do not harm them.',
];
const LOCALE_INVARIANT_LINES: Record<string, true> = {
  '—Audrey Tang': true,
  'Taipei · SPARKFUL': true,
};

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

  test('lands the Taipei talk as a public record with an answered-question spine', () => {
    for (const locale of listLocales()) {
      const { event, assets } = getContent(locale);
      expect(event.eventId, locale).toBe(PLATFORM_ID);

      expect(event.record.transcript.external, locale).toBe(true);
      expect(event.record.transcript.href, locale).toBe(
        locale === 'zh-tw' ? TRANSCRIPT_ZH_URL : TRANSCRIPT_EN_URL
      );
      expect(JSON.stringify(event), locale).not.toMatch(/luma\.com|sli\.do/i);

      expect(
        event.principles.items.map((item) => item.id),
        locale
      ).toEqual([
        'reversible-first',
        'consequence-names-risk',
        'legible-receipts',
        'local-replaceable',
        'verify-exit',
      ]);
      expect(
        event.questions.groups.map((group) => group.id),
        locale
      ).toEqual(['limits', 'judgment', 'local', 'future']);

      const answered = event.questions.groups.flatMap((group) => group.items);
      expect(
        answered.map((item) => item.id),
        locale
      ).toEqual(
        Array.from({ length: 11 }, (_, index) => `answer-${String(index + 1).padStart(2, '0')}`)
      );
      expect(new Set(answered.map((item) => item.id)).size, locale).toBe(answered.length);
      for (const item of answered) {
        expect(item.question.trim().length, `${locale} ${item.id}`).toBeGreaterThan(0);
        expect(item.answer.trim().length, `${locale} ${item.id}`).toBeGreaterThan(0);
        expect(item.chapter.trim().length, `${locale} ${item.id}`).toBeGreaterThan(0);
      }

      expect(event.stats, locale).toHaveLength(3);
      expect(
        event.stats.slice(0, 2).map((stat) => stat.value),
        locale
      ).toEqual(['11', '5']);

      // The five readings remain as provenance for the map. Each locale names
      // the same five figures cropped from the public, PII-free artwork.
      const archetypeIds = ['bridgewright', 'weaver', 'craftkeeper', 'companion', 'translator'];
      expect(
        event.archetypes.items.map((item) => item.id),
        locale
      ).toEqual(archetypeIds);
      expect(
        event.archetypes.items.map((item) => item.image),
        locale
      ).toEqual(archetypeIds.map((id) => `event-arch-${id}`));
      for (const item of event.archetypes.items) {
        expect(item.quadrant.trim().length, `${locale} ${item.id}`).toBeGreaterThan(0);
        expect(assets[item.image], `${locale} ${item.id}`).toBeDefined();
      }

      // Listed as opposed axes, not clockwise round the artwork: a direction
      // is only legible next to the one it opposes.
      expect(
        event.map.axes.map((axis) => axis.id),
        locale
      ).toEqual(['crowd', 'self', 'govern', 'build']);

      expect(assets['event-archetype-map'], locale).toBeDefined();
      expect(assets['og-image-event'], locale).toBeDefined();
      for (const speaker of event.speakers.items) {
        expect(assets[speaker.image], locale).toBeDefined();
      }
    }
  });

  test('answers deep-link into the locale transcript chapter by chapter', () => {
    for (const locale of listLocales()) {
      const answered = getContent(locale).event.questions.groups.flatMap((group) => group.items);
      const transcript = locale === 'zh-tw' ? TRANSCRIPT_ZH_URL : TRANSCRIPT_EN_URL;
      const anchors = locale === 'zh-tw' ? ZH_ANCHORS : EN_ANCHORS;
      expect(
        answered.map((item) => item.href),
        locale
      ).toEqual(anchors.map((anchor) => `${transcript}#${anchor}`));
    }
  });

  test('ships source-faithful quotes, takeaways, and both transcript editions', () => {
    const zhEvent = getContent('zh-tw').event;
    expect(
      zhEvent.questions.groups.flatMap((group) => group.items.map((item) => item.chapter))
    ).toEqual(ZH_CHAPTERS);

    for (const locale of listLocales()) {
      const event = getContent(locale).event;
      for (const group of event.questions.groups) {
        expect(group.quote.text.trim().length, `${locale} ${group.id} quote`).toBeGreaterThan(0);
        expect(group.quote.by.trim().length, `${locale} ${group.id} attribution`).toBeGreaterThan(
          0
        );
      }
      expect(event.mottos.items, locale).toHaveLength(2);
      for (const motto of event.mottos.items) {
        expect(motto.text.trim().length, locale).toBeGreaterThan(0);
        expect(motto.by.trim().length, locale).toBeGreaterThan(0);
      }

      const alternateTranscript = locale === 'zh-tw' ? TRANSCRIPT_EN_URL : TRANSCRIPT_ZH_URL;
      expect(event.record.altTranscript.href, locale).toBe(alternateTranscript);
      expect(event.record.altTranscript.external, locale).toBe(true);
      expect(event.record.altTranscript.label.trim().length, locale).toBeGreaterThan(0);
    }

    const english = getContent('en').event;
    expect(english.questions.groups.map((group) => group.quote.text)).toEqual(EN_QUOTES);
    expect(english.mottos.items.map((motto) => motto.text)).toEqual(EN_MOTTOS);
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
        ...event.stats.map((stat) => stat.label),
        event.record.eyebrow,
        event.record.title,
        event.record.when,
        event.record.place,
        event.record.body,
        event.record.transcript.label,
        event.record.altTranscript.label,
        event.record.videoTitle,
        event.principles.title,
        event.principles.lead,
        ...event.principles.items.flatMap((item) => [item.title, item.body]),
        event.questions.eyebrow,
        event.questions.title,
        event.questions.lead,
        event.questions.answerLabel,
        event.questions.chapterLabel,
        event.questions.linkLabel,
        ...event.questions.groups.flatMap((group) => [
          group.title,
          group.lead,
          group.quote.text,
          group.quote.by,
          ...group.items.flatMap((item) => [item.question, item.answer, item.chapter]),
        ]),
        event.map.title,
        event.map.lead,
        event.map.imageAlt,
        event.map.caption,
        event.map.axesTitle,
        event.map.legendTitle,
        ...event.map.axes.flatMap((axis) => [axis.label, axis.body]),
        ...event.archetypes.items.flatMap((item) => [item.name, item.quadrant]),
        event.speakers.title,
        event.speakers.lead,
        ...event.speakers.items.flatMap((item) => [item.role, item.body]),
        event.mottos.title,
        ...event.mottos.items.flatMap((item) => [item.text, item.by]),
        event.source,
      ];
    }

    const reference = proseByLocale.en!;
    for (const locale of locales) {
      const lines = proseByLocale[locale]!;
      expect(lines.length, locale).toBe(reference.length);
      for (const line of lines) {
        expect(line.trim().length, locale).toBeGreaterThan(0);
        // Case-sensitive, and anchored on word boundaries: `/TODO/i` matches
        // Spanish "todos" and Portuguese "todo", so it fails real copy.
        expect(line, locale).not.toMatch(/\bTODO\b|\bFIXME\b|[Ll]orem [Ii]psum/);
      }
      if (locale === 'en') continue;
      expect(
        lines.filter(
          (line, index) => line === reference[index] && LOCALE_INVARIANT_LINES[line] !== true
        )
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
