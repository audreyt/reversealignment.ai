import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://www.reversealignment.ai',
  base: './',
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory' },
  compressHTML: true,
});
