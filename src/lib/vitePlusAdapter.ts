import { fileURLToPath } from 'node:url';
import { build as astroBuild, dev as astroDev } from 'astro';
import type { ConfigEnv, Plugin, ViteBuilder } from 'vite';

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url));

type CommandEnvironment = Pick<ConfigEnv, 'command' | 'mode'> & {
  isPreview?: boolean;
};

type AstroDevServer = {
  address: { port: number };
  stop(): Promise<void>;
};

export type AstroBuildBridgeDependencies = {
  buildAstro?: () => Promise<void>;
};

/**
 * `vp dev`/`vp build` run this same config in "serve" mode for local dev,
 * "test" mode under the test harness, and "build" mode for `vp build`. Only
 * real interactive dev (not a preview server, not the test harness) should
 * pay for spinning up Astro's own dev server underneath the Vite+ proxy.
 */
export function isAstroDevCommand({
  command,
  mode,
  isPreview = false,
}: CommandEnvironment): boolean {
  return command === 'serve' && mode !== 'test' && !isPreview;
}

export type AstroDevProxyDependencies = {
  startAstro?: () => Promise<AstroDevServer>;
};

type StartAstroDevServer = (
  inlineConfig: Parameters<typeof astroDev>[0]
) => Promise<AstroDevServer>;

/**
 * Starts Astro's own dev server. `dev` is injectable so tests can cover
 * this without spinning up a real Astro dev server.
 */
export function startAstroDevServer(dev: StartAstroDevServer = astroDev): Promise<AstroDevServer> {
  return dev({ server: { host: '127.0.0.1', port: 0 } });
}

/**
 * Proxies Vite+'s dev server to a real Astro dev server so `vp dev` gets
 * Astro's routing behavior instead of raw Vite.
 */
export function createAstroDevProxy(dependencies: AstroDevProxyDependencies = {}): Plugin {
  let astroServer: AstroDevServer | undefined;
  const startAstro = dependencies.startAstro ?? startAstroDevServer;

  return {
    name: 'reversealignment:astro-dev-proxy',
    apply: 'serve',
    async config(_config, environment) {
      if (!isAstroDevCommand(environment)) return;

      astroServer = await startAstro();
      const target = `http://127.0.0.1:${astroServer.address.port}`;

      return {
        server: {
          hmr: false,
          proxy: {
            '/': {
              changeOrigin: true,
              target,
              ws: true,
            },
          },
        },
      };
    },
    configureServer(viteServer) {
      // Stop the proxied Astro server whenever Vite+'s own server closes so
      // `vp dev` never leaves an orphaned Astro process behind.
      viteServer.httpServer?.once('close', () => {
        void astroServer?.stop();
      });
    },
  };
}

/**
 * Runs Astro's static build. `build` is injectable so tests can cover this
 * without running a real Astro production build.
 */
export async function buildAstroSite(build: typeof astroBuild = astroBuild): Promise<void> {
  await build({});
}

/**
 * Bridges `vp build` to the real Astro static build. Astro owns the entire
 * `dist/` output for this site, so every Vite build environment is marked
 * built once Astro finishes rather than letting Vite attempt its own bundling.
 */
export function createAstroBuildBridge(dependencies: AstroBuildBridgeDependencies = {}): Plugin {
  const buildAstro = dependencies.buildAstro ?? buildAstroSite;

  return {
    name: 'reversealignment:astro-build',
    apply: 'build',
    config(_config, environment) {
      if (environment.command !== 'build') return;

      return {
        builder: {
          async buildApp(builder: ViteBuilder): Promise<void> {
            await buildAstro();

            for (const buildEnvironment of Object.values(builder.environments)) {
              buildEnvironment.isBuilt = true;
            }
          },
        },
      };
    },
  };
}

/** Project root used by tests that assert default paths. */
export function getProjectRoot(): string {
  return PROJECT_ROOT;
}
