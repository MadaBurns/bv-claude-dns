import { describe, it, expect } from 'vitest';
import { authHeaders, resolveApiKey } from '../src/auth.js';

describe('authHeaders (free-tier guard — issue #28)', () => {
  it('attaches no Authorization header when key is undefined', () => {
    expect(authHeaders(undefined)).toEqual({});
  });

  it('attaches no Authorization header when key is an empty string', () => {
    expect(authHeaders('')).toEqual({});
  });

  it('treats undefined and "" identically (both → free tier, no header)', () => {
    expect(authHeaders(undefined)).toEqual(authHeaders(''));
  });

  it('attaches a bearer header only for a non-empty key', () => {
    expect(authHeaders('bvk_abc123')).toEqual({ Authorization: 'Bearer bvk_abc123' });
  });

  it('Authorization key is never present for falsy keys', () => {
    expect('Authorization' in authHeaders(undefined)).toBe(false);
    expect('Authorization' in authHeaders('')).toBe(false);
  });
});

describe('resolveApiKey', () => {
  it('returns "" when BV_API_KEY is unset (and no key file)', () => {
    // Point HOME at a dir with no ~/.bv-dns/api-key so the file fallback misses.
    expect(resolveApiKey({ HOME: '/nonexistent-bv-dns-home' } as NodeJS.ProcessEnv)).toBe('');
  });

  it('returns "" for an unresolved MCPB placeholder', () => {
    expect(
      resolveApiKey({ BV_API_KEY: '${user_config.bv_api_key}', HOME: '/nonexistent-bv-dns-home' } as NodeJS.ProcessEnv),
    ).toBe('');
  });

  it('returns "" for an empty-string env value', () => {
    expect(resolveApiKey({ BV_API_KEY: '', HOME: '/nonexistent-bv-dns-home' } as NodeJS.ProcessEnv)).toBe('');
  });

  it('returns "" for a whitespace-only env value', () => {
    expect(resolveApiKey({ BV_API_KEY: '   ', HOME: '/nonexistent-bv-dns-home' } as NodeJS.ProcessEnv)).toBe('');
  });

  it('returns the trimmed key for a real value', () => {
    expect(resolveApiKey({ BV_API_KEY: '  bvk_xyz  ' } as NodeJS.ProcessEnv)).toBe('bvk_xyz');
  });
});
