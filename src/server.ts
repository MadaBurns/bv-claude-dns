// SPDX-License-Identifier: BUSL-1.1
//
// MCP proxy server for Blackveil DNS.
// Uses the MCP SDK (McpServer + StdioServerTransport) so Claude Desktop
// recognises it as a proper MCP server. Tool calls are proxied to the
// remote hosted Worker via HTTPS.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { request as httpsRequest } from 'node:https';

const MCP_URL = 'https://dns-mcp.blackveilsecurity.com/mcp';
// Ignore unresolved MCPB placeholder or empty values
const rawKey = process.env.BV_API_KEY ?? '';
const API_KEY = rawKey.startsWith('${') ? '' : rawKey;
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
		};
		if (API_KEY) headers['Authorization'] = `Bearer ${API_KEY}`;
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
		clientInfo: { name: 'bv-claude-dns-proxy', version: '1.0.0' },
	});
	// Send initialized notification
	await new Promise<void>((resolve, reject) => {
		const body = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' });
		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		if (API_KEY) headers['Authorization'] = `Bearer ${API_KEY}`;
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
// Static tool definitions — registered immediately so Claude Desktop can
// connect and list tools without waiting for any remote calls.
// ---------------------------------------------------------------------------

const DOMAIN_PARAM = { domain: z.string().describe('Domain to check (e.g., example.com)') };
const DOMAIN_OPTIONAL = { ...DOMAIN_PARAM, format: z.enum(['full', 'compact']).optional().describe('Output format') };

const TOOLS: Array<{ name: string; description: string; params: Record<string, z.ZodTypeAny> }> = [
	{ name: 'scan_domain', description: 'Full DNS and email security audit. Score, grade, maturity, findings. Start here.', params: { ...DOMAIN_PARAM, profile: z.enum(['auto', 'mail_enabled', 'enterprise_mail', 'non_mail', 'web_only', 'minimal']).optional(), force_refresh: z.boolean().optional(), format: z.enum(['full', 'compact']).optional() } },
	{ name: 'check_spf', description: 'Validate SPF syntax, policy, and trust surface.', params: DOMAIN_OPTIONAL },
	{ name: 'check_dmarc', description: 'Validate DMARC policy, alignment, and reporting.', params: DOMAIN_OPTIONAL },
	{ name: 'check_dkim', description: 'Probe DKIM selectors and validate key strength.', params: { ...DOMAIN_OPTIONAL, selector: z.string().optional().describe('DKIM selector. Omit to probe common ones.') } },
	{ name: 'check_mx', description: 'Validate MX records and email provider detection.', params: DOMAIN_OPTIONAL },
	{ name: 'check_dnssec', description: 'Verify DNSSEC validation and DNSKEY/DS records.', params: DOMAIN_OPTIONAL },
	{ name: 'check_ssl', description: 'Verify SSL/TLS certificate and HTTPS config.', params: DOMAIN_OPTIONAL },
	{ name: 'check_mta_sts', description: 'Validate MTA-STS SMTP encryption policy.', params: DOMAIN_OPTIONAL },
	{ name: 'check_ns', description: 'Analyze NS delegation and provider diversity.', params: DOMAIN_OPTIONAL },
	{ name: 'check_caa', description: 'Check authorized Certificate Authorities via CAA.', params: DOMAIN_OPTIONAL },
	{ name: 'check_bimi', description: 'Validate BIMI record and VMC evidence.', params: DOMAIN_OPTIONAL },
	{ name: 'check_tlsrpt', description: 'Validate TLS-RPT SMTP failure reporting.', params: DOMAIN_OPTIONAL },
	{ name: 'check_http_security', description: 'Audit HTTP security headers (CSP, COOP, etc.).', params: DOMAIN_OPTIONAL },
	{ name: 'check_dane', description: 'Verify DANE/TLSA certificate pinning.', params: DOMAIN_OPTIONAL },
	{ name: 'check_dane_https', description: 'Verify DANE certificate pinning for HTTPS.', params: DOMAIN_OPTIONAL },
	{ name: 'check_svcb_https', description: 'Validate HTTPS/SVCB records (RFC 9460).', params: DOMAIN_OPTIONAL },
	{ name: 'check_lookalikes', description: 'Detect active typosquat/lookalike domains.', params: DOMAIN_OPTIONAL },
	{ name: 'check_shadow_domains', description: 'Detect shadow/subdomain takeover risks.', params: DOMAIN_OPTIONAL },
	{ name: 'check_txt_hygiene', description: 'Audit TXT record hygiene and accumulation.', params: DOMAIN_OPTIONAL },
	{ name: 'check_mx_reputation', description: 'Check MX server IP reputation via DNSBLs.', params: DOMAIN_OPTIONAL },
	{ name: 'check_srv', description: 'Discover SRV records for common services.', params: DOMAIN_OPTIONAL },
	{ name: 'check_zone_hygiene', description: 'Audit DNS zone configuration hygiene.', params: DOMAIN_OPTIONAL },
	{ name: 'check_resolver_consistency', description: 'Compare DNS responses across resolvers.', params: { ...DOMAIN_OPTIONAL, record_type: z.string().optional() } },
	{ name: 'assess_spoofability', description: 'Assess email spoofing risk for a domain.', params: DOMAIN_OPTIONAL },
	{ name: 'compare_baseline', description: 'Compare domain security against a policy baseline.', params: { domain: z.string(), baseline: z.record(z.unknown()).optional(), format: z.enum(['full', 'compact']).optional() } },
	{ name: 'generate_fix_plan', description: 'Generate a prioritised remediation plan from scan results.', params: DOMAIN_OPTIONAL },
	{ name: 'generate_spf_record', description: 'Generate an SPF record for a domain.', params: { domain: z.string(), include_providers: z.array(z.string()).optional(), ip4: z.array(z.string()).optional(), ip6: z.array(z.string()).optional(), mechanism: z.enum(['-all', '~all', '?all']).optional() } },
	{ name: 'generate_dmarc_record', description: 'Generate a DMARC record for a domain.', params: { domain: z.string(), policy: z.enum(['none', 'quarantine', 'reject']).optional(), rua: z.string().optional(), ruf: z.string().optional(), pct: z.number().optional(), aspf: z.enum(['r', 's']).optional(), adkim: z.enum(['r', 's']).optional() } },
	{ name: 'generate_dkim_config', description: 'Generate DKIM configuration guidance.', params: { domain: z.string(), selector: z.string().optional(), key_size: z.number().optional() } },
	{ name: 'generate_mta_sts_policy', description: 'Generate an MTA-STS policy for a domain.', params: { domain: z.string(), mode: z.enum(['testing', 'enforce', 'none']).optional(), mx_hosts: z.array(z.string()).optional(), max_age: z.number().optional() } },
	{ name: 'get_benchmark', description: 'Get industry benchmark data for a domain category.', params: { domain: z.string(), industry: z.string().optional(), format: z.enum(['full', 'compact']).optional() } },
	{ name: 'get_provider_insights', description: 'Get DNS/email provider analysis and recommendations.', params: DOMAIN_OPTIONAL },
	{ name: 'explain_finding', description: 'Explain a specific security finding in detail.', params: { finding_id: z.string().describe('Finding ID (e.g., spf_softfail, dmarc_missing)'), context: z.string().optional() } },
];

// ---------------------------------------------------------------------------
// Main — register tools and connect immediately.
// ---------------------------------------------------------------------------

const server = new McpServer({
	name: 'Blackveil DNS',
	version: '1.0.0',
});

for (const tool of TOOLS) {
	server.tool(tool.name, tool.description, tool.params, async (args) => {
		return callRemoteTool(tool.name, args as Record<string, unknown>);
	});
}

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[bv-proxy] Ready — ${TOOLS.length} tools, proxying to ${MCP_URL}`);
