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
	// Bundle ALL deps into single file — no node_modules needed in .mcpb
	noExternal: [/.*/],
	banner: { js: '#!/usr/bin/env node' },
});
