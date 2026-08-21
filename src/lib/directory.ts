export type DirectoryPerson = {
  id: string;
  fullName: string;
  role: string;
  affiliation: string;
  sector: string;
  /** Optional profile copy for catalog entries that have an archived biography. */
  bio?: string;
  /** Catalog portrait key, or empty when the card uses monogram/API art. */
  imageKey: string;
  sortIndex: number;
  /** Optional remote portrait URL (Worker /api/portrait/…). */
  portraitUrl?: string | null;
  /** Inline monogram data URI used when no catalog/API photo exists. */
  avatarDataUri?: string | null;
  source?: 'canonical' | 'community';
};

export const directorySectorValues = [
  'Research',
  'Technology',
  'Government',
  'Philanthropy',
  'Civil Society',
  'Business',
  'Entertainment',
  'Media',
] as const;

export type DirectorySectorOption = {
  value: (typeof directorySectorValues)[number];
  label: string;
};

/** Labels stay in taxonomy order; only populated categories render as controls. */
export function visibleDirectorySectorOptions(
  people: readonly Pick<DirectoryPerson, 'sector'>[],
  labels: readonly string[]
): DirectorySectorOption[] {
  const populated = new Set(people.map((person) => person.sector));
  return directorySectorValues
    .map((value, index) => ({ value, label: labels[index] ?? value }))
    .filter((option) => populated.has(option.value));
}

/**
 * Keep every taxonomy control in document order. Used when the roster can grow
 * after first paint from the live API, so a sector that starts empty still
 * has a button ready once members arrive.
 */
export function allDirectorySectorOptions(labels: readonly string[]): DirectorySectorOption[] {
  return directorySectorValues.map((value, index) => ({
    value,
    label: labels[index] ?? value,
  }));
}

export type DirectoryFilters = {
  q: string;
  sector: string;
  sort: string;
};

const DEFAULT_SORT = 'default';

function normalizeSort(raw: string): string {
  const sort = raw.trim();
  if (!sort || sort === 'canonical') return DEFAULT_SORT;
  return sort;
}

export function parseDirectorySearch(params: URLSearchParams): DirectoryFilters {
  return {
    q: (params.get('q') ?? '').trim().slice(0, 80),
    sector: (params.get('sector') ?? '').trim(),
    sort: normalizeSort(params.get('sort') ?? ''),
  };
}

export function directorySearchString(filters: DirectoryFilters): string {
  const params = new URLSearchParams();
  if (filters.q.length > 0) params.set('q', filters.q);
  if (filters.sector.length > 0) params.set('sector', filters.sector);
  if (filters.sort !== DEFAULT_SORT) params.set('sort', filters.sort);
  return params.toString();
}

export function filterSortPeople(
  people: readonly DirectoryPerson[],
  filters: DirectoryFilters
): DirectoryPerson[] {
  const q = filters.q.toLowerCase();
  const list = people.filter((person) => {
    if (filters.sector.length > 0 && person.sector !== filters.sector) return false;
    if (q.length === 0) return true;
    const haystack = `${person.fullName} ${person.role} ${person.affiliation}`.toLowerCase();
    return haystack.includes(q);
  });

  const byName = (a: DirectoryPerson, b: DirectoryPerson) =>
    a.fullName.localeCompare(b.fullName, undefined, { sensitivity: 'base' });

  if (filters.sort === 'name') return [...list].sort(byName);
  if (filters.sort === 'name-desc') return [...list].sort((a, b) => byName(b, a));
  if (filters.sort === 'sector') {
    return [...list].sort((a, b) => a.sector.localeCompare(b.sector) || byName(a, b));
  }

  return [...list].sort((a, b) => a.sortIndex - b.sortIndex || byName(a, b));
}

export function formatCountTemplate(template: string, shown: number, total: number): string {
  return template.replaceAll('{shown}', String(shown)).replaceAll('{total}', String(total));
}

export function isDirectorySector(value: string): value is (typeof directorySectorValues)[number] {
  return (directorySectorValues as readonly string[]).includes(value);
}

/**
 * Merge community rows into the SSR founding roster. Existing ids win so
 * localized founding cards keep their portraits and translated roles.
 */
export function mergeDirectoryPeople(
  seed: readonly DirectoryPerson[],
  community: readonly DirectoryPerson[]
): DirectoryPerson[] {
  const seen = new Set(seed.map((person) => person.id));
  const merged = [...seed];
  for (const person of community) {
    if (seen.has(person.id)) continue;
    seen.add(person.id);
    merged.push(person);
  }
  return merged;
}

/** Map a public Worker /api/members row when the live API is available. */
export type PublicApiMember = {
  id: string;
  fullName: string;
  role: string;
  affiliation: string;
  sector: string;
  source?: string;
  imageKey?: string | null;
  avatar?: string;
  portraitUrl?: string | null;
  sortIndex?: number;
};

export function publicApiMemberAsDirectory(
  member: PublicApiMember,
  options: {
    apiOrigin: string;
    avatarDataUriForName: (fullName: string) => string;
  }
): DirectoryPerson | null {
  const id = typeof member.id === 'string' ? member.id.trim() : '';
  const fullName = typeof member.fullName === 'string' ? member.fullName.trim() : '';
  const sector = typeof member.sector === 'string' ? member.sector.trim() : '';
  if (!id || !fullName || !isDirectorySector(sector)) return null;

  const role = typeof member.role === 'string' ? member.role.trim() : '';
  const affiliation = typeof member.affiliation === 'string' ? member.affiliation.trim() : '';
  const sortIndex = Number.isFinite(member.sortIndex) ? Number(member.sortIndex) : 1000;
  const source = member.source === 'community' ? 'community' : 'canonical';

  let portraitUrl: string | null = null;
  if (typeof member.portraitUrl === 'string' && member.portraitUrl.startsWith('/api/portrait/')) {
    portraitUrl = `${options.apiOrigin.replace(/\/+$/, '')}${member.portraitUrl}`;
  }

  const imageKey =
    typeof member.imageKey === 'string' &&
    member.imageKey &&
    !member.imageKey.startsWith('portraits/')
      ? member.imageKey
      : '';

  return {
    id,
    fullName,
    role: role || affiliation || sector,
    affiliation,
    sector,
    imageKey,
    sortIndex,
    portraitUrl,
    avatarDataUri: portraitUrl || imageKey ? null : options.avatarDataUriForName(fullName),
    source,
  };
}
