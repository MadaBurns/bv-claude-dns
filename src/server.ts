// SPDX-License-Identifier: BUSL-1.1
//
// Thin stdio-to-HTTP proxy for the Blackveil DNS MCP server.
// Reads JSON-RPC from stdin, POSTs to the hosted Worker via
// HTTPS, writes responses to stdout.
//
// Uses node:https instead of fetch for maximum Node.js compatibility
// across Claude Desktop's built-in runtime versions.

import { request as httpsRequest } from 'node:https';

const MCP_URL = 'https://dns-mcp.blackveilsecurity.com/mcp';
const API_KEY = process.env.BV_API_KEY ?? '';

// stdout is the exclusive JSON-RPC channel — redirect logs to stderr
console.log = console.error;

// Keep the process alive
const keepAlive = setInterval(() => {}, 60_000);

let sessionId: string | undefined;

function forwardToRemote(line: string): Promise<void> {
	return new Promise((resolve, reject) => {
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

		const req = httpsRequest(
			MCP_URL,
			{ method: 'POST', headers },
			(res) => {
				let body = '';
				res.setEncoding('utf8');
				res.on('data', (chunk: string) => {
					body += chunk;
				});
				res.on('end', () => {
					// Capture session ID
					const sid = res.headers['mcp-session-id'];
					if (typeof sid === 'string') {
						sessionId = sid;
					}

					if (res.statusCode && res.statusCode >= 400) {
						console.error(`[bv-proxy] HTTP ${res.statusCode}: ${body}`);
					}

					// Forward any JSON-RPC response to stdout
					if (body.trim()) {
						process.stdout.write(body + '\n');
					}
					resolve();
				});
			},
		);

		req.on('error', (err) => {
			console.error('[bv-proxy] Request error:', err.message);
			reject(err);
		});

		req.write(line);
		req.end();
	});
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
	void pending.then(() => {
		clearInterval(keepAlive);
	});
});

process.on('uncaughtException', (err) => {
	console.error('[bv-proxy] Uncaught exception:', err);
});

process.on('unhandledRejection', (err) => {
	console.error('[bv-proxy] Unhandled rejection:', err);
});

process.stdin.resume();
console.error('[bv-proxy] Ready — proxying to', MCP_URL);
