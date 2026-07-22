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

export type Person = {
  name: string;
  role: string;
  image: string;
};

export type FormField = {
  /** Readable submitted name (mailto text/plain body key). */
  name: string;
  label: string;
  type: 'text' | 'email' | 'textarea' | 'select';
  required?: boolean;
  options?: string[];
  autocomplete?: string;
  /**
   * Optional stable DOM id fragment. When omitted, derived by slugifying `name`.
   * MUST be a valid HTML id token (no spaces); never use the human `name` raw.
   */
  id?: string;
};

export type FormSpec = {
  id: string;
  action: string;
  method?: 'get' | 'post';
  enctype?: string;
  submitLabel: string;
  fields: FormField[];
  errorMessage?: string;
  successMessage?: string;
  /** Honest static-mail copy: submit opens a mail client; not a server receipt. */
  mailClientNote?: string;
};

export type CoalitionPerson = {
  kind: 'person';
  name: string;
  role: string;
  image: string;
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
    join: Cta;
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
    notifyForm: FormSpec;
    applyCta: Cta;
  };
  coalition: {
    title: string;
    lead: string;
    body: string;
    sectors: string[];
    people: CoalitionPerson[];
  };
  join: {
    eyebrow: string;
    title: string;
    lead: string;
    body: string;
    form: FormSpec;
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
    formErrors: string;
  };
  assets: Record<string, string>;
};
