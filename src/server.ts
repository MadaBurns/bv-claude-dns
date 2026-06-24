// SPDX-License-Identifier: BUSL-1.1
//
// MCP proxy server for Blackveil DNS.
// Uses the MCP SDK (McpServer + StdioServerTransport) so Claude Desktop
// recognises it as a proper MCP server. Tool calls are proxied to the
// remote hosted Worker via HTTPS.
//
// Tool catalog is fetched LIVE from the upstream `tools/list` at startup, so
// the proxy can never advertise a tool the backend can't serve. A baked-in
// fallback (FALLBACK_TOOLS) is used only when the upstream is unreachable.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { request as httpsRequest } from 'node:https';
import { FALLBACK_TOOLS } from './fallback-tools.js';
import { resolveApiKey, authHeaders } from './auth.js';

const PROXY_VERSION = '2.9.1';
const MCP_URL = 'https://dns-mcp.blackveilsecurity.com/mcp';
const USER_AGENT = `bv-claude-dns-proxy/${PROXY_VERSION}`;

// Resolve once at startup. Empty string ⇒ free tier (no Authorization header).
const API_KEY = resolveApiKey();

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2 MB
const REQUEST_TIMEOUT_MS = 30_000; // 30 seconds

let remoteSessionId: string | undefined;
let remoteInitialized = false;

/** POST a JSON-RPC request to the remote Worker. */
function remoteCall(method: string, params: Record<string, unknown>): Promise<{ result?: unknown; error?: unknown }> {
	return new Promise((resolve, reject) => {
		const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			Accept: 'application/json',
			'User-Agent': USER_AGENT,
			...authHeaders(API_KEY),
		};
		if (remoteSessionId) headers['Mcp-Session-Id'] = remoteSessionId;

		const req = httpsRequest(MCP_URL, { method: 'POST', headers, timeout: REQUEST_TIMEOUT_MS }, (res) => {
			let data = '';
			let bytes = 0;
			res.setEncoding('utf8');
			res.on('data', (chunk: string) => {
				bytes += Buffer.byteLength(chunk);
				if (bytes > MAX_RESPONSE_BYTES) {
					res.destroy();
					reject(new Error('Response exceeded 2 MB limit'));
					return;
				}
				data += chunk;
			});
			res.on('end', () => {
				const sid = res.headers['mcp-session-id'];
				if (typeof sid === 'string') remoteSessionId = sid;
				try { resolve(JSON.parse(data)); }
				catch { reject(new Error(`Invalid JSON: ${data.slice(0, 200)}`)); }
			});
		});
		req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
		req.on('error', reject);
		req.write(body);
		req.end();
	});
}

/** Lazily initialize the remote session on first tool call. */
async function ensureRemoteInit(): Promise<void> {
	if (remoteInitialized) return;
	await remoteCall('initialize', {
		protocolVersion: '2025-03-26',
		capabilities: {},
		clientInfo: { name: 'bv-claude-dns-proxy', version: PROXY_VERSION },
	});
	// Send initialized notification
	await new Promise<void>((resolve, reject) => {
		const body = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' });
		const headers: Record<string, string> = { 'Content-Type': 'application/json', ...authHeaders(API_KEY) };
		if (remoteSessionId) headers['Mcp-Session-Id'] = remoteSessionId;
		const req = httpsRequest(MCP_URL, { method: 'POST', headers, timeout: REQUEST_TIMEOUT_MS }, (res) => {
			res.resume();
			res.on('end', () => resolve());
		});
		req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
		req.on('error', reject);
		req.write(body);
		req.end();
	});
	remoteInitialized = true;
}

/** Proxy a tool call to the remote Worker. */
async function callRemoteTool(name: string, args: Record<string, unknown>) {
	await ensureRemoteInit();
	const resp = await remoteCall('tools/call', { name, arguments: args });
	if (resp.error) {
		const err = resp.error as { message?: string };
		return { content: [{ type: 'text' as const, text: err.message ?? 'Remote error' }], isError: true };
	}
	if (resp.result && typeof resp.result === 'object' && 'content' in resp.result) {
		return resp.result as { content: Array<{ type: 'text'; text: string }>; isError?: boolean };
	}
	return { content: [{ type: 'text' as const, text: JSON.stringify(resp.result) }] };
}

// ---------------------------------------------------------------------------
// JSON Schema → Zod shape converter
//
// The upstream `tools/list` returns a full JSON Schema per tool. We convert
// the top-level `properties` into a Zod raw shape so Claude Desktop sees the
// real argument hints. Anything we can't model precisely degrades to a
// permissive type — the upstream Worker is the authoritative validator, so the
// proxy's local schema only drives the UI, never security.
// ---------------------------------------------------------------------------

interface JsonSchema {
	type?: string | string[];
	description?: string;
	enum?: unknown[];
	items?: JsonSchema;
	properties?: Record<string, JsonSchema>;
	required?: string[];
	[k: string]: unknown;
}

function jsonSchemaToZod(schema: JsonSchema): z.ZodTypeAny {
	const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];

	if (Array.isArray(schema.enum) && schema.enum.length > 0) {
		const strings = schema.enum.filter((v): v is string => typeof v === 'string');
		if (strings.length === schema.enum.length && strings.length > 0) {
			return z.enum(strings as [string, ...string[]]);
		}
	}

	if (types.includes('string')) return z.string();
	if (types.includes('number') || types.includes('integer')) return z.number();
	if (types.includes('boolean')) return z.boolean();
	if (types.includes('array')) {
		const item = schema.items ? jsonSchemaToZod(schema.items) : z.unknown();
		return z.array(item);
	}
	if (types.includes('object')) {
		if (schema.properties) {
			return objectShapeToZod(schema).strict().passthrough();
		}
		return z.record(z.string(), z.unknown());
	}
	return z.unknown();
}

function objectShapeToZod(schema: JsonSchema): z.ZodObject<Record<string, z.ZodTypeAny>> {
	const required = new Set(schema.required ?? []);
	const shape: Record<string, z.ZodTypeAny> = {};
	for (const [key, propSchema] of Object.entries(schema.properties ?? {})) {
		let zodType = jsonSchemaToZod(propSchema);
		if (propSchema.description) zodType = zodType.describe(propSchema.description);
		if (!required.has(key)) zodType = zodType.optional();
		shape[key] = zodType;
	}
	return z.object(shape);
}

/** Build the Zod raw shape (param map) for `server.tool()` from a tool's inputSchema. */
function toolParamShape(inputSchema: JsonSchema | undefined): Record<string, z.ZodTypeAny> {
	if (!inputSchema || !inputSchema.properties) return {};
	const required = new Set(inputSchema.required ?? []);
	const shape: Record<string, z.ZodTypeAny> = {};
	for (const [key, propSchema] of Object.entries(inputSchema.properties)) {
		let zodType = jsonSchemaToZod(propSchema);
		if (propSchema.description) zodType = zodType.describe(propSchema.description);
		if (!required.has(key)) zodType = zodType.optional();
		shape[key] = zodType;
	}
	return shape;
}

interface RemoteToolDef {
	name: string;
	description?: string;
	inputSchema?: JsonSchema;
}

/**
 * Fetch the live tool catalog from the upstream `tools/list`. Returns the
 * baked-in fallback set if the upstream is unreachable / malformed, so the
 * proxy still starts and serves a usable (if possibly slightly stale) catalog.
 */
async function fetchToolCatalog(): Promise<{ tools: RemoteToolDef[]; live: boolean }> {
	try {
		await ensureRemoteInit();
		const resp = await remoteCall('tools/list', {});
		const result = resp.result as { tools?: RemoteToolDef[] } | undefined;
		if (resp.error || !result?.tools || result.tools.length === 0) {
			throw new Error('empty or errored tools/list');
		}
		return { tools: result.tools, live: true };
	} catch (err) {
		console.error(`[bv-proxy] Could not fetch live tool catalog (${(err as Error).message}); using bundled fallback.`);
		return { tools: FALLBACK_TOOLS as RemoteToolDef[], live: false };
	}
}

// ---------------------------------------------------------------------------
// Main — fetch the live catalog, register tools, connect.
// ---------------------------------------------------------------------------

const server = new McpServer({
	name: 'Blackveil DNS',
	version: PROXY_VERSION,
});

const { tools, live } = await fetchToolCatalog();

for (const tool of tools) {
	server.tool(
		tool.name,
		tool.description ?? '',
		toolParamShape(tool.inputSchema),
		async (args) => callRemoteTool(tool.name, args as Record<string, unknown>),
	);
}

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[bv-proxy] Ready — ${tools.length} tools (${live ? 'live' : 'fallback'}), proxying to ${MCP_URL}`);
