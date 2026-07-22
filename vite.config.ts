import { defineConfig } from 'vite-plus';
import { createAstroBuildBridge, createAstroDevProxy } from './src/lib/vitePlusAdapter';

export default defineConfig({
  fmt: {
    semi: true,
    singleQuote: true,
    tabWidth: 2,
    trailingComma: 'es5',
    ignorePatterns: [
      'node_modules/**',
      '.astro/**',
      'dist/**',
      'public/**',
      'src/data/**',
      '.reference/**',
      '.tmp/**',
      '.home/**',
      '.npm-cache/**',
    ],
  },
  lint: {
    jsPlugins: [{ name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' }],
    rules: { 'vite-plus/prefer-vite-plus-imports': 'error' },
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: [
      'node_modules/**',
      'public/**',
      '.astro/**',
      'dist/**',
      '.reference/**',
      '.tmp/**',
      '.home/**',
      '.npm-cache/**',
    ],
  },
  staged: {
    '**/*': 'vp fmt',
    '*.{ts,tsx,js,jsx}': 'vp lint --fix',
  },
  server: {
    host: '127.0.0.1',
    port: 4321,
  },
  test: {
    include: ['tests/unit/**/*.test.{ts,js}'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    environment: 'node',
    globalSetup: ['./tests/global-setup.ts'],
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/lib/**/*.{ts,js}'],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
  plugins: [createAstroBuildBridge(), createAstroDevProxy()],
});
