// SPDX-License-Identifier: BUSL-1.1
//
// Thin stdio-to-HTTP proxy for the Blackveil DNS MCP server.
// Reads JSON-RPC from stdin, POSTs to the hosted Worker via
// Streamable HTTP, writes responses to stdout.

const MCP_URL = 'https://dns-mcp.blackveilsecurity.com/mcp';
const API_KEY = process.env.BV_API_KEY ?? '';

// stdout is the exclusive JSON-RPC channel — redirect logs to stderr
console.log = console.error;

let sessionId: string | undefined;

async function forwardToRemote(line: string): Promise<void> {
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		Accept: 'application/json',
	};
	if (API_KEY) {
		headers['Authorization'] = `Bearer ${API_KEY}`;
	}
	if (sessionId) {
		headers['Mcp-Session-Id'] = sessionId;
	}

	const response = await fetch(MCP_URL, {
		method: 'POST',
		headers,
		body: line,
	});

	// Capture session ID from initialize response
	const sid = response.headers.get('mcp-session-id');
	if (sid) {
		sessionId = sid;
	}

	if (!response.ok) {
		const text = await response.text();
		console.error(`[bv-proxy] HTTP ${response.status}: ${text}`);
		// Surface JSON-RPC errors to the client
		if (response.headers.get('content-type')?.includes('application/json')) {
			process.stdout.write(text + '\n');
		}
		return;
	}

	const body = await response.text();
	if (body.trim()) {
		process.stdout.write(body + '\n');
	}
}

let buffer = '';
let pending = Promise.resolve();

function flushLine(line: string): void {
	pending = pending
		.then(() => forwardToRemote(line))
		.catch((err: unknown) => {
			const message = err instanceof Error ? err.message : 'Unknown proxy error';
			console.error(`[bv-proxy] ${message}`);
		});
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
	buffer += chunk;
	const lines = buffer.split(/\r?\n/);
	buffer = lines.pop() ?? '';
	for (const line of lines) {
		if (line.trim()) flushLine(line);
	}
});

process.stdin.on('end', () => {
	if (buffer.trim()) {
		flushLine(buffer);
		buffer = '';
	}
});

process.stdin.resume();
console.error('[bv-proxy] Ready — proxying to', MCP_URL);
