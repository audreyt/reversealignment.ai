import type content from '../data/content.json';

/** Locale codes are exactly the top-level keys of `src/data/content.json`. */
export type Locale = keyof typeof content;

export type NavLink = {
  id: string;
  label: string;
  href: string;
};

export type Cta = {
  label: string;
  href: string;
  external?: boolean;
  disabled?: boolean;
  note?: string;
};

export type FailureMode = {
  number: string;
  title: string;
  body: string;
};

export type Challenge = {
  id: string;
  number: string;
  title: string;
  body: string;
  image: string;
  accent?: string;
};

export type Paper = {
  id: string;
  venue: string;
  title: string;
  body: string;
  cta: Cta;
  image?: string;
  tone: 'lime' | 'violet';
};

export type SlideSet = {
  directory: string;
  count: number;
  document: string;
};

export type ResourceLink = {
  id: string;
  title: string;
  body: string;
  cta: Cta;
  slides: SlideSet;
};

export type CoalitionPerson = {
  kind: 'person';
  name: string;
  role: string;
  image: string;
  /** Stable English sector key used by the fixed client-side directory. */
  sector: string;
};

export type CoalitionEvent = {
  id: string;
  /** ISO 8601 instant. Machine-readable start, rendered as `<time datetime>`. */
  startsAt: string;
  /** ISO 8601 instant. The listing drops off the first build made after this passes. */
  endsAt: string;
  /** Localized date and time line, naming the zones this locale's readers live in. */
  when: string;
  title: string;
  body: string;
  cta: Cta;
};

export type FormField = {
  /** Submitted field key (API body). */
  name: string;
  label: string;
  type: 'text' | 'email' | 'textarea' | 'select' | 'url';
  required?: boolean;
  /** Select options: stable English `value` + localized `label`. */
  options?: Array<string | { value: string; label: string }>;
  autocomplete?: string;
  maxLength?: number;
  placeholder?: string;
  /**
   * Optional stable DOM id fragment. When omitted, derived by slugifying `name`.
   * MUST be a valid HTML id token (no spaces); never use the human `name` raw.
   */
  id?: string;
};

/**
 * Copy for the optional in-browser portrait step. Required whenever a form is
 * `live`; brochure locales have no form to render it in.
 */
export type FormPhotoCopy = {
  label: string;
  hint: string;
  removeLabel: string;
  processingLabel: string;
  readyLabel: string;
  /** Shown when the browser could not screen the chosen image at all. */
  errorMessage: string;
  /** Shown when the portrait could not be attached to a live submission. */
  uploadFailed: string;
  /** Shown when the verified submission was stored without the portrait. */
  storeFailed: string;
};

export type FormSpec = {
  id: string;
  /** Submit path relative to the join page (`api` → `/join/api`). */
  action: string;
  method?: 'get' | 'post';
  /** `live` only on the Access-protected English join page. */
  mode: 'live' | 'cta-only';
  submitLabel: string;
  fields: FormField[];
  honeypotName: string;
  errorMessage: string;
  networkError: string;
  successTitle: string;
  successMessage: string;
  /** Non-directory intent confirmation (stay informed / expertise / etc.). */
  updatesTitle: string;
  updatesMessage: string;
  pendingTitle: string;
  rateLimited: string;
  duplicateEmail: string;
  moderationHold: string;
  privacyNote: string;
  avatarNote: string;
  avatarPreviewLabel: string;
  /** Required when `mode === 'live'` — the live form renders the photo step. */
  photo?: FormPhotoCopy;
};

/**
 * Copy for the Access-gated self-service entry management page (/join/manage/).
 */
export type ManageCopy = {
  eyebrow: string;
  title: string;
  lead: string;
  fullNameLabel: string;
  affiliationLabel: string;
  sectorLabel: string;
  statusLabel: string;
  /** Localized labels for internal member statuses (`pending_review`, `published`, `rejected`, `suspended`, `updates_only`). */
  statusLabels: Record<
    'pending_review' | 'published' | 'rejected' | 'suspended' | 'updates_only',
    string
  >;
  portraitLabel: string;
  portraitRemoveLabel: string;
  saveLabel: string;
  savedMessage: string;
  deleteTitle: string;
  /** Explains that deletion hard-deletes the row, private address, and R2 portrait. */
  deleteWarning: string;
  deleteConfirmLabel: string;
  deleteLabel: string;
  deletedMessage: string;
  /** Shown when no member row is associated with the authenticated Access email. */
  notFoundMessage: string;
  /** Shown when an Access session expires or returns non-JSON HTML. */
  reauthMessage: string;
  errorMessage: string;
  networkError: string;
  /** Shown when self-service updates or deletes hit rate limiters. */
  rateLimited: string;
  /** Shown when a renamed full name collides with another published member's normalized name key. */
  nameCollision: string;
};

export type DirectorySortOption = {
  value: string;
  label: string;
};

export type DirectoryCopy = {
  searchLabel: string;
  searchPlaceholder: string;
  sectorLabel: string;
  sectorAll: string;
  sortLabel: string;
  sortOptions: DirectorySortOption[];
  countTemplate: string;
  empty: string;
  keyboardHint: string;
  bioLabel: string;
};

export type FooterColumn = {
  title: string;
  links: NavLink[];
};

export type NotFoundCopy = {
  title: string;
  heading: string;
  body: string;
  backLabel: string;
  code: string;
};

/**
 * One of the five ways of carrying a question, as read off the event map. The
 * page no longer defines these in prose: the axis panel defines the four
 * directions, and a name beside its quadrant composes the rest.
 */
export type EventArchetype = {
  /** Stable English key, identical across locales; also the DOM id fragment. */
  id: string;
  name: string;
  /**
   * Quadrant, phrased in the same axis words the map rim uses. Headcounts are
   * live and go stale between builds; a quadrant does not.
   */
  quadrant: string;
  /** Key into `assets`; the figure cropped from the map artwork. Decorative:
   * the adjacent name carries the accessible text. */
  image: string;
};

/** One of the five operating moves distilled from the public event record. */
export type EventPrinciple = {
  /** Stable key, identical across locales. */
  id: string;
  title: string;
  body: string;
};

/** One of the four directions printed on the map rim. */
export type EventAxis = {
  id: string;
  label: string;
  body: string;
};

export type EventSpeaker = {
  id: string;
  name: string;
  role: string;
  body: string;
  /** Key into `assets`. */
  image: string;
  link: Cta;
};

/** Label over value, as rendered in the hero's definition list. */
export type EventStat = {
  label: string;
  value: string;
};

/** One question-and-answer thread that appears in the public transcript. */
export type EventAnsweredQuestion = {
  /** Stable deep-link target, identical across locales. */
  id: string;
  question: string;
  /** Editorial compression of the answer; the transcript remains canonical. */
  answer: string;
  /** The transcript chapter that carries this answer. */
  chapter: string;
  /** Deep link to this chapter in the locale's transcript edition. */
  href: string;
};

/** Public transcript sentence in its published language or a faithful locale translation. */
export type EventQuote = {
  text: string;
  by: string;
};

/** A navigational group in the answered-question spine. */
export type EventQuestionGroup = {
  /** Stable section id, identical across locales. */
  id: string;
  title: string;
  lead: string;
  /** Public transcript sentence localized for this edition. */
  quote: EventQuote;
  items: EventAnsweredQuestion[];
};

/**
 * Copy for `/events/you-are-here/`, the post-event record of the 29 Aug 2026
 * Taipei talk. Every locale ships the page; archive.tw remains the canonical
 * turn-by-turn source and this page makes its answered threads navigable.
 */
export type EventCopy = {
  /** The `coalition.events` id this page belongs to. */
  eventId: string;
  metaTitle: string;
  metaDescription: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  body: string;
  stats: EventStat[];
  /** Label on the link back to the locale's own home page. */
  homeLabel: string;
  record: {
    eyebrow: string;
    title: string;
    when: string;
    place: string;
    body: string;
    /**
     * Primary transcript: zh-TW points at the 華文 edition; every other locale
     * points at English.
     */
    transcript: Cta;
    /** Other public edition: English for zh-TW, Traditional Chinese otherwise. */
    altTranscript: Cta;
    /** Accessible name for the talk recording iframe. */
    videoTitle: string;
  };
  principles: {
    title: string;
    lead: string;
    items: EventPrinciple[];
  };
  questions: {
    eyebrow: string;
    title: string;
    lead: string;
    answerLabel: string;
    chapterLabel: string;
    linkLabel: string;
    groups: EventQuestionGroup[];
  };
  map: {
    title: string;
    lead: string;
    /** Describes the artwork for readers who cannot see it, in this locale. */
    imageAlt: string;
    caption: string;
    axesTitle: string;
    axes: EventAxis[];
    legendTitle: string;
  };
  /** Translated labels for the five stable readings drawn on the map. */
  archetypes: {
    items: EventArchetype[];
  };
  speakers: {
    title: string;
    lead: string;
    items: EventSpeaker[];
  };
  /** Localized closing take-away lines from the public transcript. */
  mottos: {
    title: string;
    items: EventQuote[];
  };
  /** Provenance line distinguishing the transcript from editorial compression. */
  source: string;
};

export type SiteContent = {
  meta: {
    title: string;
    description: string;
    ogImage: string;
  };
  brand: {
    name: string;
    shortName: string;
    mark: string;
    rest: string;
  };
  nav: {
    coalition: Cta;
    links: NavLink[];
  };
  hero: {
    headline: string;
    body: string;
    primaryCta: Cta;
    secondaryCta: Cta;
  };
  idea: {
    eyebrow: string;
    title: string;
    lead: string;
    body: string[];
    definitionLead: string;
    definitionTerm: string;
    definitionRest: string;
    historyTitle: string;
    historyBody: string[];
    failuresIntro: string[];
    failures: FailureMode[];
    failuresClose: string[];
  };
  building: {
    eyebrow: string;
    title: string;
    lead: string;
    summary: string;
    hoverHint: string;
    clickHint: string;
    challengesIntro: string;
    challenges: Challenge[];
  };
  claim: {
    eyebrow: string[];
    title: string;
    lead: string;
    columns: string[];
    cta: Cta;
  };
  papers: {
    eyebrow: string;
    title: string;
    items: Paper[];
    resources: ResourceLink[];
    viewer: {
      dialogLabel: string;
      closeLabel: string;
      previousLabel: string;
      nextLabel: string;
      downloadLabel: string;
      openHint: string;
      statusTemplate: string;
      slideLabelTemplate: string;
      thumbnailRegionLabelTemplate: string;
      thumbnailLabelTemplate: string;
    };
  };
  story: {
    title: string;
    lead: string;
    guideTitle: string[];
    guideTerm: string;
    guideRest: string;
    guideCta: Cta;
    videoCaption: string;
    videoCta: Cta;
  };
  grants: {
    eyebrow: string;
    title: string;
    body: string[];
    fundingLine: string;
    panelBody: string[];
    filmsNote: string;
    applyCta: Cta;
  };
  coalition: {
    title: string;
    lead: string;
    body: string;
    eventsTitle: string;
    events: CoalitionEvent[];
    sectors: string[];
    people: CoalitionPerson[];
    directory: DirectoryCopy;
  };
  event: EventCopy;
  join: {
    eyebrow: string;
    title: string;
    lead: string;
    body: string;
    /** Homepage always uses `cta`; the live form lives on `/join/`. */
    mode: 'cta';
    cta: Cta;
    form: FormSpec;
    manage: ManageCopy;
  };
  closing: {
    lines: string[];
  };
  footer: {
    brand: string;
    columns: FooterColumn[];
    copyright: string;
  };
  notFound: NotFoundCopy;
  a11y: {
    skipToContent: string;
    mainNav: string;
    openMenu: string;
    closeMenu: string;
    externalLink: string;
    heroMotionLabel: string;
    challengeGrid: string;
    coalitionGrid: string;
    directoryControls: string;
    directoryResults: string;
    formErrors: string;
    formStatus: string;
  };
  assets: Record<string, string>;
};
