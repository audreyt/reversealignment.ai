export const DIRECTORY_CONTRIBUTIONS = [
  'Lend your name to the statement',
  'All of the above',
] as const;

export type DirectoryContribution = (typeof DIRECTORY_CONTRIBUTIONS)[number];

export function isDirectoryContribution(value: string): value is DirectoryContribution {
  return (DIRECTORY_CONTRIBUTIONS as readonly string[]).includes(value);
}
