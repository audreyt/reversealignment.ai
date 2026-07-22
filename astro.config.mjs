import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://www.reversealignment.ai',
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory' },
  compressHTML: true,
});
