// SPDX-License-Identifier: BUSL-1.1
//
// API-key resolution and auth-header construction for the Blackveil DNS proxy.
// Single source of truth for the "should we send Authorization?" decision so
// the free tier is never broken by an inadvertently-attached bearer token.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Resolve the configured API key. Returns an empty string for "no key"
 * (free tier). Unresolved MCPB placeholders (`${user_config.bv_api_key}`),
 * encrypted blobs, and whitespace-only values are all treated as absent.
 * Falls back to a local `~/.bv-dns/api-key` file if env is unset.
 */
export function resolveApiKey(env: NodeJS.ProcessEnv = process.env): string {
	const rawKey = (env.BV_API_KEY ?? '').trim();
	if (rawKey && !rawKey.startsWith('${') && !rawKey.startsWith('__encrypted__')) {
		return rawKey;
	}
	try {
		return readFileSync(join(homedir(), '.bv-dns', 'api-key'), 'utf-8').trim();
	} catch {
		return '';
	}
}

/**
 * Build auth headers, attaching `Authorization: Bearer <key>` ONLY when a
 * non-empty key is given. `undefined` and `""` are treated identically →
 * NO auth header (free tier). Attaching an empty/placeholder bearer makes the
 * upstream reject the request ("Remove the token to use the free tier"), which
 * is exactly the bug this guards against.
 */
export function authHeaders(apiKey: string | undefined): Record<string, string> {
	return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}
