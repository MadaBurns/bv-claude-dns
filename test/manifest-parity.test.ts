import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { FALLBACK_TOOLS } from '../src/fallback-tools.js';

const ROOT = join(import.meta.dirname, '..');

function getManifestTools(): string[] {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf-8'));
  return manifest.tools.map((t: { name: string }) => t.name).sort();
}

function getFallbackTools(): string[] {
  return FALLBACK_TOOLS.map((t) => t.name).sort();
}

function getManifestVersion(): string {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf-8'));
  return manifest.version;
}

function getPackageVersion(): string {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
  return pkg.version;
}

const DEAD_TOOLS = [
  'generate_fix_plan',
  'generate_spf_record',
  'generate_dmarc_record',
  'generate_dkim_config',
  'generate_mta_sts_policy',
  'generate_rollout_plan',
];

describe('manifest / fallback parity', () => {
  // The proxy serves the upstream `tools/list` verbatim at runtime; manifest.json
  // and the bundled fallback are generated from the same source by
  // scripts/sync-tools.mjs, so they must agree with each other.
  it('manifest tools match the bundled fallback catalog exactly', () => {
    const manifestTools = getManifestTools();
    const fallbackTools = getFallbackTools();

    const missingFromManifest = fallbackTools.filter((t) => !manifestTools.includes(t));
    const extraInManifest = manifestTools.filter((t) => !fallbackTools.includes(t));

    expect(missingFromManifest, 'Tools in fallback but missing from manifest').toEqual([]);
    expect(extraInManifest, 'Tools in manifest but missing from fallback').toEqual([]);
    expect(manifestTools).toEqual(fallbackTools);
  });

  it('manifest version matches package.json version', () => {
    expect(getManifestVersion()).toBe(getPackageVersion());
  });

  it('does not advertise the removed generate_* tools (consolidated into "generate")', () => {
    const manifestTools = getManifestTools();
    const fallbackTools = getFallbackTools();
    for (const dead of DEAD_TOOLS) {
      expect(manifestTools, `manifest must not list ${dead}`).not.toContain(dead);
      expect(fallbackTools, `fallback must not list ${dead}`).not.toContain(dead);
    }
    expect(manifestTools, 'replacement "generate" tool present').toContain('generate');
  });

  it('manifest description count matches the tool count', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf-8'));
    const m = manifest.description.match(/\b(\d+) tools\b/);
    expect(m, 'description states a tool count').not.toBeNull();
    expect(Number(m![1])).toBe(manifest.tools.length);
  });
});
