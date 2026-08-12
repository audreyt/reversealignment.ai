import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_DIST = fileURLToPath(new URL('../dist', import.meta.url));
const ROOT_LOCAL_ATTRIBUTE = /\b(href|src|action|poster)=(["'])(\/(?!\/)[^"']*)\2/g;
const ROOT_LOCAL_CSS_URL = /url\((["']?)(\/(?!\/)[^)"']+)\1\)/g;

function relativeUrlFromRoot(filePath: string, distDir: string, value: string): string {
  const suffixIndex = value.search(/[?#]/);
  const pathname = suffixIndex === -1 ? value : value.slice(0, suffixIndex);
  const suffix = suffixIndex === -1 ? '' : value.slice(suffixIndex);
  const rootPath = pathname.replace(/^\/(?:\.\/)*/, '');
  const targetPath = resolve(distDir, rootPath);
  let outputPath = relative(dirname(filePath), targetPath).split(sep).join('/');

  if (outputPath === '') outputPath = '.';
  if (!outputPath.startsWith('.')) outputPath = `./${outputPath}`;
  if (pathname.endsWith('/') && !outputPath.endsWith('/')) outputPath += '/';

  return `${outputPath}${suffix}`;
}

async function collectRuntimeFiles(directory: string, originalArchive: string): Promise<string[]> {
  if (resolve(directory) === originalArchive) return [];

  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectRuntimeFiles(path, originalArchive)));
    } else if (entry.name.endsWith('.html') || entry.name.endsWith('.css')) {
      files.push(path);
    }
  }
  return files;
}

/**
 * Makes every runtime URL in Astro's static output independent of host and
 * repository prefix. The archived Readymag source is deliberately untouched.
 */
export async function relativizeDistAssets(distDir: string = DEFAULT_DIST): Promise<void> {
  const originalArchive = resolve(distDir, 'assets/original');
  const files = await collectRuntimeFiles(distDir, originalArchive);
  let changed = 0;

  for (const filePath of files) {
    const source = await readFile(filePath, 'utf8');
    let output = source.replace(
      ROOT_LOCAL_CSS_URL,
      (_match: string, quote: string, value: string) =>
        `url(${quote}${relativeUrlFromRoot(filePath, distDir, value)}${quote})`
    );

    if (filePath.endsWith('.html')) {
      output = output.replace(
        ROOT_LOCAL_ATTRIBUTE,
        (_match: string, attribute: string, quote: string, value: string) =>
          `${attribute}=${quote}${relativeUrlFromRoot(filePath, distDir, value)}${quote}`
      );
    }

    const rootAttribute = filePath.endsWith('.html')
      ? output.match(/\b(?:href|src|action|poster)=(["'])\/(?!\/)/)
      : null;
    const rootCssUrl = output.match(/url\((?:["']?)\/(?!\/)/);
    if (rootAttribute || rootCssUrl) {
      throw new Error(`Root-absolute runtime URL remains in ${relative(distDir, filePath)}`);
    }

    if (output !== source) {
      await writeFile(filePath, output);
      changed++;
    }
  }

  console.log(`relativizeDistAssets: ${changed} of ${files.length} runtime files updated`);
}
