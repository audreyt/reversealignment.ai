import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const scratch = path.join(projectRoot, '.tmp');

function resolveBin(name: string): string {
  const local = path.join(projectRoot, 'node_modules', '.bin', name);
  if (existsSync(local)) return local;
  return name;
}

function run(bin: string, args: string[]): void {
  mkdirSync(scratch, { recursive: true });
  execFileSync(bin, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      ASTRO_TELEMETRY_DISABLED: '1',
      XDG_CONFIG_HOME: path.join(scratch, 'config'),
      XDG_DATA_HOME: path.join(scratch, 'data'),
      XDG_CACHE_HOME: path.join(scratch, 'cache'),
      HOME: path.join(scratch, 'home'),
    },
  });
}

/** Regenerate Astro ambient types and typecheck before the suite runs. */
export default function setup(): void {
  run(resolveBin('astro'), ['sync']);
  run(resolveBin('tsc'), ['--noEmit']);
}
