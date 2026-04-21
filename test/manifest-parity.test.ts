import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');

function getManifestTools(): string[] {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf-8'));
  return manifest.tools.map((t: { name: string }) => t.name).sort();
}

function getRuntimeTools(): string[] {
  const src = readFileSync(join(ROOT, 'src/server.ts'), 'utf-8');
  const matches = src.matchAll(/\{\s*name:\s*'([^']+)',\s*description:/g);
  return [...matches].map((m) => m[1]).sort();
}

function getManifestVersion(): string {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf-8'));
  return manifest.version;
}

function getPackageVersion(): string {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
  return pkg.version;
}

describe('manifest parity', () => {
  it('manifest tools match runtime tools exactly', () => {
    const manifestTools = getManifestTools();
    const runtimeTools = getRuntimeTools();

    const missingFromManifest = runtimeTools.filter((t) => !manifestTools.includes(t));
    const extraInManifest = manifestTools.filter((t) => !runtimeTools.includes(t));

    expect(missingFromManifest, 'Tools in runtime but missing from manifest').toEqual([]);
    expect(extraInManifest, 'Tools in manifest but missing from runtime').toEqual([]);
    expect(manifestTools).toEqual(runtimeTools);
  });

  it('manifest version matches package.json version', () => {
    expect(getManifestVersion()).toBe(getPackageVersion());
  });

  it('has exactly 51 tools', () => {
    const runtimeTools = getRuntimeTools();
    expect(runtimeTools).toHaveLength(51);
  });
});
