import { describe, expect, test } from 'vite-plus/test';
import {
  allDirectorySectorOptions,
  directorySearchString,
  filterSortPeople,
  formatCountTemplate,
  mergeDirectoryPeople,
  parseDirectorySearch,
  publicApiMemberAsDirectory,
  type DirectoryPerson,
  visibleDirectorySectorOptions,
} from '../../src/lib/directory';

const people: DirectoryPerson[] = [
  {
    id: 'canonical:ada',
    fullName: 'Ada Lovelace',
    role: 'Analyst',
    affiliation: 'Analytical Engine',
    sector: 'Research',
    imageKey: 'person-ada',
    sortIndex: 1,
  },
  {
    id: 'canonical:grace',
    fullName: 'Grace Hopper',
    role: 'Rear Admiral',
    affiliation: 'USN',
    sector: 'Technology',
    imageKey: 'person-grace',
    sortIndex: 2,
  },
  {
    id: 'canonical:alan',
    fullName: 'Alan Turing',
    role: 'Researcher',
    affiliation: 'Bletchley Park',
    sector: 'Research',
    imageKey: 'person-alan',
    sortIndex: 0,
  },
  {
    id: 'canonical:babbage',
    fullName: 'Charles Babbage',
    role: 'Inventor',
    affiliation: 'Cambridge',
    sector: 'Research',
    imageKey: 'person-babbage',
    sortIndex: 1,
  },
];

describe('directory filters', () => {
  test('parses and serializes URL state', () => {
    const query = new URLSearchParams('q=%20Ada%20&sector=Research&sort=canonical');
    expect(parseDirectorySearch(query)).toEqual({ q: 'Ada', sector: 'Research', sort: 'default' });
    expect(parseDirectorySearch(new URLSearchParams('q=' + 'x'.repeat(90)))).toEqual({
      q: 'x'.repeat(80),
      sector: '',
      sort: 'default',
    });
    expect(directorySearchString({ q: '', sector: '', sort: 'default' })).toBe('');
    expect(directorySearchString({ q: 'Ada', sector: 'Research', sort: 'name' })).toBe(
      'q=Ada&sector=Research&sort=name'
    );
  });

  test('shows only populated sector controls and restores a matching localized label', () => {
    const labels = ['研究', '科技', '政府', '慈善', '公民社會', '企業', '娛樂', '媒體'];
    expect(visibleDirectorySectorOptions(people, labels)).toEqual([
      { value: 'Research', label: '研究' },
      { value: 'Technology', label: '科技' },
    ]);

    expect(visibleDirectorySectorOptions(people, [])).toEqual([
      { value: 'Research', label: 'Research' },
      { value: 'Technology', label: 'Technology' },
    ]);

    expect(
      visibleDirectorySectorOptions(
        [...people, { ...people[0], id: 'canonical:entertainment', sector: 'Entertainment' }],
        labels
      )
    ).toEqual([
      { value: 'Research', label: '研究' },
      { value: 'Technology', label: '科技' },
      { value: 'Entertainment', label: '娛樂' },
    ]);

    expect(allDirectorySectorOptions(labels)).toHaveLength(8);
    expect(allDirectorySectorOptions(labels)[6]).toEqual({ value: 'Entertainment', label: '娛樂' });
    expect(allDirectorySectorOptions([])[0]).toEqual({ value: 'Research', label: 'Research' });
  });

  test('filters by static fields and applies each supported ordering', () => {
    expect(
      filterSortPeople(people, { q: 'analytical', sector: '', sort: 'default' }).map(
        (person) => person.fullName
      )
    ).toEqual(['Ada Lovelace']);
    expect(
      filterSortPeople(people, { q: '', sector: 'Research', sort: 'default' }).map(
        (person) => person.fullName
      )
    ).toEqual(['Alan Turing', 'Ada Lovelace', 'Charles Babbage']);
    expect(
      filterSortPeople(people, { q: '', sector: '', sort: 'name' }).map((person) => person.fullName)
    ).toEqual(['Ada Lovelace', 'Alan Turing', 'Charles Babbage', 'Grace Hopper']);
    expect(
      filterSortPeople(people, { q: '', sector: '', sort: 'name-desc' }).map(
        (person) => person.fullName
      )
    ).toEqual(['Grace Hopper', 'Charles Babbage', 'Alan Turing', 'Ada Lovelace']);
    expect(
      filterSortPeople(people, { q: '', sector: '', sort: 'sector' }).map(
        (person) => person.fullName
      )
    ).toEqual(['Ada Lovelace', 'Alan Turing', 'Charles Babbage', 'Grace Hopper']);
    expect(
      filterSortPeople(people, { q: '', sector: '', sort: 'default' }).map(
        (person) => person.fullName
      )
    ).toEqual(['Alan Turing', 'Ada Lovelace', 'Charles Babbage', 'Grace Hopper']);
  });

  test('parses canonical sort into the default ordering and round-trips', () => {
    const parsed = parseDirectorySearch(new URLSearchParams('sort=canonical'));
    expect(parsed).toEqual({ q: '', sector: '', sort: 'default' });
    expect(directorySearchString(parsed)).toBe('');
    expect(parseDirectorySearch(new URLSearchParams('sort=name-desc')).sort).toBe('name-desc');
  });

  test('retains the fixed catalog order for unknown sort values', () => {
    const result = filterSortPeople(people, { q: '', sector: '', sort: 'unknown' });
    expect(result.map((person) => person.fullName)).toEqual([
      'Alan Turing',
      'Ada Lovelace',
      'Charles Babbage',
      'Grace Hopper',
    ]);
    expect(formatCountTemplate('Showing {shown} of {total}', 1, 25)).toBe('Showing 1 of 25');
  });

  test('maps API member records and keeps seed ids when merging', () => {
    const opts = {
      apiOrigin: 'https://join.reversealignment.tw/',
      avatarDataUriForName: (name: string) => `mono:${name}`,
    };
    const apiMember = publicApiMemberAsDirectory(
      {
        id: 'mbr_imp_abc',
        fullName: 'Ada Community',
        role: 'Writer',
        affiliation: 'Civic Lab',
        sector: 'Civil Society',
        sortIndex: 1000,
        source: 'community',
      },
      opts
    );
    expect(apiMember).toMatchObject({
      id: 'mbr_imp_abc',
      fullName: 'Ada Community',
      source: 'community',
      imageKey: '',
      avatarDataUri: 'mono:Ada Community',
    });

    const merged = mergeDirectoryPeople(people, [
      apiMember!,
      { ...people[0]!, role: 'should-not-replace' },
    ]);
    expect(merged).toHaveLength(5);
    expect(merged.find((person) => person.id === 'canonical:ada')?.role).toBe('Analyst');
    expect(merged.at(-1)?.id).toBe('mbr_imp_abc');
  });

  test('resolves API portrait URLs against the members origin', () => {
    const opts = {
      apiOrigin: 'https://join.reversealignment.tw/',
      avatarDataUriForName: (name: string) => `mono:${name}`,
    };
    const person = publicApiMemberAsDirectory(
      {
        id: 'mbr_live',
        fullName: 'Live Member',
        role: 'Engineer',
        affiliation: 'Lab',
        sector: 'Technology',
        source: 'community',
        portraitUrl: '/api/portrait/abcd.webp',
        sortIndex: 1200,
      },
      opts
    );
    expect(person).toMatchObject({
      id: 'mbr_live',
      portraitUrl: 'https://join.reversealignment.tw/api/portrait/abcd.webp',
      avatarDataUri: null,
      source: 'community',
    });

    const catalogKeyed = publicApiMemberAsDirectory(
      {
        id: 'canonical:person-glen-weyl',
        fullName: 'Eric Glen Weyl',
        role: 'Co-founder',
        affiliation: 'RxC',
        sector: 'Civil Society',
        source: 'canonical',
        imageKey: 'person-glen-weyl',
        portraitUrl: null,
      },
      opts
    );
    expect(catalogKeyed).toMatchObject({
      imageKey: 'person-glen-weyl',
      portraitUrl: null,
      avatarDataUri: null,
      source: 'canonical',
      sortIndex: 1000,
    });

    const monogram = publicApiMemberAsDirectory(
      {
        id: 'mbr_mono',
        fullName: 'Mono',
        role: '   ',
        affiliation: '',
        sector: 'Research',
        source: 'community',
        imageKey: 'portraits/deadbeef.webp',
        portraitUrl: 'https://evil.example/x',
        sortIndex: Number.NaN,
      },
      opts
    );
    expect(monogram).toMatchObject({
      role: 'Research',
      imageKey: '',
      portraitUrl: null,
      avatarDataUri: 'mono:Mono',
      source: 'community',
    });

    expect(
      publicApiMemberAsDirectory(
        { id: '', fullName: 'X', role: '', affiliation: '', sector: 'Research' },
        opts
      )
    ).toBe(null);
    expect(
      publicApiMemberAsDirectory(
        { id: 'x', fullName: 'X', role: '', affiliation: '', sector: 'Nope' },
        opts
      )
    ).toBe(null);
  });

  test('rejects non-string API fields', () => {
    const mono = (name: string) => `mono:${name}`;
    const opts = {
      apiOrigin: 'https://join.reversealignment.tw',
      avatarDataUriForName: mono,
    };
    expect(
      publicApiMemberAsDirectory(
        {
          id: 9 as unknown as string,
          fullName: 'X',
          role: 'R',
          affiliation: 'A',
          sector: 'Research',
        },
        opts
      )
    ).toBe(null);
    expect(
      publicApiMemberAsDirectory(
        {
          id: 'ok',
          fullName: 8 as unknown as string,
          role: 'R',
          affiliation: 'A',
          sector: 'Research',
        },
        opts
      )
    ).toBe(null);
    expect(
      publicApiMemberAsDirectory(
        {
          id: 'ok',
          fullName: 'Name',
          role: 7 as unknown as string,
          affiliation: 6 as unknown as string,
          sector: 'Research',
          imageKey: 5 as unknown as string,
          portraitUrl: 4 as unknown as string,
        },
        opts
      )
    ).toMatchObject({
      role: 'Research',
      affiliation: '',
      imageKey: '',
      portraitUrl: null,
      avatarDataUri: 'mono:Name',
    });
    expect(
      publicApiMemberAsDirectory(
        {
          id: 'ok',
          fullName: 'Name',
          role: 'R',
          affiliation: 'A',
          sector: 3 as unknown as string,
        },
        opts
      )
    ).toBe(null);
  });
});
