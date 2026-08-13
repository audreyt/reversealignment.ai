import { isDirectoryContribution } from '../../src/lib/join-intent';

export const SECTORS = [
  'Research',
  'Technology',
  'Government',
  'Philanthropy',
  'Civil Society',
  'Business',
  'Entertainment',
  'Media',
] as const;

export type Sector = (typeof SECTORS)[number];

/**
 * Stable contribution values submitted by every locale form. Labels may be
 * localized; the Worker classifies intent from these English keys only.
 */
export const CONTRIBUTIONS = [
  'Lend your name to the statement',
  'Bring a challenge into your own organization or sector',
  'Contribute expertise, writing, or research',
  'Help fund the work',
  'Stay informed as the coalition grows',
  'All of the above',
] as const;

export type Contribution = (typeof CONTRIBUTIONS)[number];

export type JoinIntent = 'directory' | 'updates';

/**
 * Localized contribution labels already accepted by pre-value/label forms.
 * Map them onto the canonical English key so intent classification stays stable.
 */
const CONTRIBUTION_ALIASES: Record<string, Contribution> = {
  // zh-TW
  連署這份聲明: 'Lend your name to the statement',
  把挑戰帶進自己的組織或領域: 'Bring a challenge into your own organization or sector',
  '貢獻專業、寫作或研究': 'Contribute expertise, writing, or research',
  出資支持這項工作: 'Help fund the work',
  隨時掌握聯盟動態: 'Stay informed as the coalition grows',
  以上皆是: 'All of the above',
  // ja
  声明に名前を連ねる: 'Lend your name to the statement',
  自分の組織や分野に課題を持ち込む: 'Bring a challenge into your own organization or sector',
  '専門知・執筆・研究で貢献する': 'Contribute expertise, writing, or research',
  資金面で支援する: 'Help fund the work',
  最新情報を受け取る: 'Stay informed as the coalition grows',
  すべて: 'All of the above',
  // es
  'Prestar mi nombre a la declaración': 'Lend your name to the statement',
  'Llevar un reto a mi organización o sector':
    'Bring a challenge into your own organization or sector',
  'Aportar experiencia, escritura o investigación': 'Contribute expertise, writing, or research',
  'Ayudar a financiar el trabajo': 'Help fund the work',
  'Mantener me informado': 'Stay informed as the coalition grows',
  'Todo lo anterior': 'All of the above',
  // pt-BR
  'Emprestar meu nome à declaração': 'Lend your name to the statement',
  'Levar um desafio à minha organização ou setor':
    'Bring a challenge into your own organization or sector',
  'Contribuir com expertise, escrita ou pesquisa': 'Contribute expertise, writing, or research',
  'Ajudar a financiar o trabalho': 'Help fund the work',
  'Receber novidades': 'Stay informed as the coalition grows',
  'Tudo acima': 'All of the above',
};

/** Normalize a submitted contribution label/value to the canonical English key. */
export function normalizeContribution(raw: string): string {
  const value = raw.trim();
  if (!value) return '';
  if ((CONTRIBUTIONS as readonly string[]).includes(value)) return value;
  return CONTRIBUTION_ALIASES[value] ?? value;
}

/**
 * Directory-capable intents enter human review. Everything else (stay informed,
 * expertise-only, blank, unknown) is retained as updates-only and never queued
 * for public directory publication.
 */
export function classifyJoinIntent(contribution: string): JoinIntent {
  const normalized = normalizeContribution(contribution);
  return isDirectoryContribution(normalized) ? 'directory' : 'updates';
}

/** Join details after Access has already supplied the verified email. */
export type JoinPayload = {
  fullName: string;
  affiliation: string;
  sector: Sector;
  /** Filled by the Worker from the Access JWT — never trusted from the body. */
  email: string;
  contribution: string;
  links: string;
  statement: string;
  website: string;
};

export type FieldErrors = Record<string, string>;

const URL_RE = /^https:\/\/[^\s/$.?#].[^\s]*$/i;

function clip(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.normalize('NFC').trim().slice(0, max);
}

function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    // C0 controls except TAB(9), LF(10), CR(13)
    if (code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d) return true;
  }
  return false;
}

/**
 * Validate join details. Email is not read from the body — the caller injects the
 * Access-verified address after this returns ok.
 */
export function parseJoinBody(
  input: unknown
): { ok: true; data: JoinPayload } | { ok: false; errors: FieldErrors } {
  const body = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const errors: FieldErrors = {};

  const fullName = clip(body.fullName ?? body['Full Name'], 120);
  const affiliation = clip(body.affiliation ?? body.Affiliation, 160);
  const sectorRaw = clip(body.sector ?? body.Sector, 40);
  const contribution = normalizeContribution(clip(body.contribution, 200));
  const links = clip(body.links, 300);
  const statement = clip(body.statement, 500);
  const website = clip(body.website ?? body.company_website, 200);

  if (fullName.length < 2) errors.fullName = 'Enter your full name.';
  if (!(SECTORS as readonly string[]).includes(sectorRaw)) errors.sector = 'Choose a sector.';
  if (links && !URL_RE.test(links)) errors.links = 'Links must be https:// URLs.';
  if (hasControlChars(fullName)) {
    errors.fullName = 'Invalid characters.';
  }
  if (hasControlChars(affiliation)) {
    errors.affiliation = 'Invalid characters.';
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    data: {
      fullName,
      affiliation,
      sector: sectorRaw as Sector,
      email: '',
      contribution,
      links,
      statement,
      website,
    },
  };
}

/**
 * Fields a member may change about their own entry through `/join/api/me`.
 *
 * `contribution` is deliberately absent. It drives `classifyJoinIntent`, which
 * decides whether a row is queued for the public directory or kept as
 * updates-only, so accepting an edit would let a member promote themselves out
 * of `updates_only` and into review without a human ever seeing it. `role` is
 * absent because it is derived from affiliation, and `email` because Access owns
 * it. Same limits and character rules as `parseJoinBody`.
 */
export type ProfileEdit = {
  fullName: string;
  affiliation: string;
  sector: Sector;
};

export function parseProfileEdit(
  input: unknown
): { ok: true; data: ProfileEdit } | { ok: false; errors: FieldErrors } {
  const body = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const errors: FieldErrors = {};

  const fullName = clip(body.fullName, 120);
  const affiliation = clip(body.affiliation, 160);
  const sectorRaw = clip(body.sector, 40);

  if (fullName.length < 2) errors.fullName = 'Enter your full name.';
  if (!(SECTORS as readonly string[]).includes(sectorRaw)) errors.sector = 'Choose a sector.';
  if (hasControlChars(fullName)) errors.fullName = 'Invalid characters.';
  if (hasControlChars(affiliation)) errors.affiliation = 'Invalid characters.';

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return { ok: true, data: { fullName, affiliation, sector: sectorRaw as Sector } };
}

export function isSector(value: string): value is Sector {
  return (SECTORS as readonly string[]).includes(value);
}
