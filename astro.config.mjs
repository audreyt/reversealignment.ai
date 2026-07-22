import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://reversealignment.tw',
  base: './',
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory' },
  compressHTML: true,
});
