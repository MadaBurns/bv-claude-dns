#!/usr/bin/env node
// Syncs manifest.json version with package.json version.
import { readFileSync, writeFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));

if (manifest.version !== pkg.version) {
	console.error(`Syncing manifest.json version: ${manifest.version} → ${pkg.version}`);
	manifest.version = pkg.version;
	writeFileSync('manifest.json', JSON.stringify(manifest, null, '\t') + '\n');
} else {
	console.error(`manifest.json version already matches: ${pkg.version}`);
}
