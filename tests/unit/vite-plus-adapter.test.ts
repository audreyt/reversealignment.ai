import { expect, test } from 'vite-plus/test';
import type { ConfigEnv, Plugin } from 'vite';
import viteConfig from '../../vite.config';
import {
  buildAstroSite,
  createAstroBuildBridge,
  createAstroDevProxy,
  getProjectRoot,
  isAstroDevCommand,
  startAstroDevServer,
} from '../../src/lib/vitePlusAdapter';

async function resolvePluginConfig(plugin: Plugin, environment: ConfigEnv): Promise<unknown> {
  if (typeof plugin.config !== 'function') {
    throw new Error('Expected a Vite config hook');
  }
  return Reflect.apply(plugin.config, undefined, [{}, environment]);
}

test('only real development activates the Astro dev bridge', () => {
  expect(isAstroDevCommand({ command: 'serve', mode: 'development' })).toBe(true);
  expect(isAstroDevCommand({ command: 'serve', mode: 'test' })).toBe(false);
  expect(
    isAstroDevCommand({
      command: 'serve',
      mode: 'production',
      isPreview: true,
    })
  ).toBe(false);
  expect(isAstroDevCommand({ command: 'build', mode: 'production' })).toBe(false);
});

test('direct vp dev uses the site port', () => {
  expect(viteConfig.server).toMatchObject({
    host: '127.0.0.1',
    port: 4321,
  });
});

test('Astro dev proxy preserves HTTP and WebSocket forwarding', async () => {
  const plugin = createAstroDevProxy({
    startAstro: async () => ({
      address: { port: 8787 },
      stop: async () => {},
    }),
  });
  const config = (await resolvePluginConfig(plugin, {
    command: 'serve',
    mode: 'development',
    isPreview: false,
  } as ConfigEnv)) as {
    server: {
      hmr: boolean;
      proxy: Record<string, { target: string; ws: boolean }>;
    };
  };

  expect(config.server.hmr).toBe(false);
  expect(config.server.proxy['/']).toMatchObject({
    target: 'http://127.0.0.1:8787',
    ws: true,
  });
});

test('Astro dev proxy is a no-op outside real dev commands', async () => {
  const plugin = createAstroDevProxy({
    startAstro: async () => {
      throw new Error('Astro dev server should not start for this command');
    },
  });

  expect(
    await resolvePluginConfig(plugin, {
      command: 'build',
      mode: 'production',
      isPreview: false,
    } as ConfigEnv)
  ).toBeUndefined();
});

test("Astro dev proxy stops the proxied server when Vite+'s server closes", async () => {
  let stopped = false;
  const plugin = createAstroDevProxy({
    startAstro: async () => ({
      address: { port: 8787 },
      stop: async () => {
        stopped = true;
      },
    }),
  });
  await resolvePluginConfig(plugin, {
    command: 'serve',
    mode: 'development',
    isPreview: false,
  } as ConfigEnv);

  const closeHandlers: Array<() => void> = [];
  const httpServer = {
    once: (event: string, handler: () => void) => {
      if (event === 'close') closeHandlers.push(handler);
    },
  };
  if (typeof plugin.configureServer !== 'function') {
    throw new Error('Expected a configureServer hook');
  }
  Reflect.apply(plugin.configureServer, undefined, [{ httpServer }]);
  for (const handler of closeHandlers) handler();
  await Promise.resolve();

  expect(stopped).toBe(true);
});

test('Astro build bridge runs Astro and marks every environment built', async () => {
  const calls: string[] = [];
  const plugin = createAstroBuildBridge({
    buildAstro: async () => {
      calls.push('astro');
    },
  });
  const config = (await resolvePluginConfig(plugin, {
    command: 'build',
    mode: 'production',
    isPreview: false,
  } as ConfigEnv)) as {
    builder: {
      buildApp(builder: { environments: Record<string, { isBuilt: boolean }> }): Promise<void>;
    };
  };
  const environments = {
    client: { isBuilt: false },
    prerender: { isBuilt: false },
  };

  await config.builder.buildApp({ environments });

  expect(calls).toEqual(['astro']);
  expect(Object.values(environments).every((environment) => environment.isBuilt)).toBe(true);
});

test('Astro build bridge is inactive for non-build Vite commands', async () => {
  const plugin = createAstroBuildBridge({
    buildAstro: async () => {},
  });

  expect(
    await resolvePluginConfig(plugin, {
      command: 'serve',
      mode: 'development',
      isPreview: false,
    } as ConfigEnv)
  ).toBeUndefined();
});

test('Astro build bridge propagates a failing Astro build', async () => {
  const plugin = createAstroBuildBridge({
    buildAstro: async () => {
      throw new Error('Astro build failed');
    },
  });
  const config = (await resolvePluginConfig(plugin, {
    command: 'build',
    mode: 'production',
    isPreview: false,
  } as ConfigEnv)) as {
    builder: {
      buildApp(builder: { environments: Record<string, { isBuilt: boolean }> }): Promise<void>;
    };
  };
  const environments = { client: { isBuilt: false } };

  await expect(config.builder.buildApp({ environments })).rejects.toThrow('Astro build failed');
  expect(environments.client.isBuilt).toBe(false);
});

test("startAstroDevServer starts Astro's dev server via the injected dev function", async () => {
  const server = await startAstroDevServer(async () => ({
    address: { port: 4123 },
    stop: async () => {},
  }));

  expect(server.address.port).toBe(4123);
});

test('buildAstroSite runs the injected Astro build function', async () => {
  let called = false;
  await buildAstroSite(async () => {
    called = true;
  });

  expect(called).toBe(true);
});

test('getProjectRoot points at this repository', () => {
  expect(getProjectRoot()).toMatch(/reversealignment\.ai\/?$/);
});
