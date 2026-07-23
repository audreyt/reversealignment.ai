import { defineConfig } from 'astro/config';
import site from './src/data/site.json' with { type: 'json' };

const deploymentLocale = process.env.SITE_LOCALE ?? site.defaultLocale;
const deploymentUrl = site.localizedUrls[deploymentLocale];

if (!deploymentUrl) {
  throw new Error(`No site URL configured for locale "${deploymentLocale}"`);
}

export default defineConfig({
  site: deploymentUrl,
  base: './',
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory' },
  compressHTML: true,
});
