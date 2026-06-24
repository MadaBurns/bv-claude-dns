#!/usr/bin/env node
// SPDX-License-Identifier: BUSL-1.1
//
// Pack-time guard (issue #29). Inspects the produced .mcpb (a zip) and fails
// if any dev cruft slipped in. Run AFTER `mcpb pack`. Picks the newest .mcpb
// in the repo root unless a path is passed as argv[2].

import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function newestMcpb() {
	const files = readdirSync(ROOT)
		.filter((f) => f.endsWith('.mcpb'))
		.map((f) => ({ f, m: statSync(join(ROOT, f)).mtimeMs }))
		.sort((a, b) => b.m - a.m);
	if (files.length === 0) {
		console.error('[check-bundle] No .mcpb found in repo root.');
		process.exit(1);
	}
	return join(ROOT, files[0].f);
}

const bundle = process.argv[2] ? join(ROOT, process.argv[2]) : newestMcpb();

// List archive entries via `unzip -Z1` (zip central directory).
let listing;
try {
	listing = execFileSync('unzip', ['-Z1', bundle], { encoding: 'utf-8' });
} catch (err) {
	console.error(`[check-bundle] Could not read ${bundle}: ${err.message}`);
	process.exit(1);
}
const entries = listing.split('\n').map((e) => e.trim()).filter(Boolean);

// Forbidden path patterns — these must never ship.
const FORBIDDEN = [
	/^\.wrangler\//,
	/(^|\/)\.wrangler\//,
	/^\.githooks\//,
	/^\.dev\.vars/,
	/(^|\/)\.dev\.vars/,
	/^docs\//,
	/\.sqlite$/,
	/^\.gitleaks\.toml$/,
	/(^|\/)\.env/,
	/^src\//,
	/\.ts$/,
	/^node_modules\//,
	/^\.git\//,
];

const offenders = entries.filter((e) => FORBIDDEN.some((re) => re.test(e)));

if (offenders.length > 0) {
	console.error(`[check-bundle] FAIL — ${bundle} contains forbidden paths:`);
	for (const o of offenders) console.error(`  - ${o}`);
	process.exit(1);
}

console.error(`[check-bundle] OK — ${bundle} (${entries.length} entries) contains no dev cruft.`);
