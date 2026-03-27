import { defineConfig } from 'tsup';

export default defineConfig({
	entry: { server: 'src/server.ts' },
	format: ['esm'],
	target: 'es2022',
	platform: 'node',
	sourcemap: false,
	splitting: false,
	treeshake: true,
	clean: true,
	// Bundle all deps into a single file for MCPB — no node_modules needed
	noExternal: [/.*/],
	banner: { js: '#!/usr/bin/env node' },
});
