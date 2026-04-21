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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const PROXY_VERSION = '2.9.1';
const MCP_URL = 'https://dns-mcp.blackveilsecurity.com/mcp';
const USER_AGENT = `bv-claude-dns-proxy/${PROXY_VERSION}`;
// Ignore unresolved MCPB placeholder, encrypted blobs, or empty values
const rawKey = process.env.BV_API_KEY ?? '';
let API_KEY = (rawKey.startsWith('${') || rawKey.startsWith('__encrypted__')) ? '' : rawKey;

if (!API_KEY) {
	try {
		API_KEY = readFileSync(join(homedir(), '.bv-dns', 'api-key'), 'utf-8').trim();
	} catch {
		// No local key file — continue unauthenticated (free tier)
	}
}
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
		clientInfo: { name: 'bv-claude-dns-proxy', version: PROXY_VERSION },
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
	{ name: 'compare_baseline', description: 'Compare domain security against a policy baseline.', params: { domain: z.string(), format: z.enum(['full', 'compact']).optional(), baseline: z.object({ grade: z.string().optional(), score: z.number().optional(), require_dmarc_enforce: z.boolean().optional(), require_spf: z.boolean().optional(), require_dkim: z.boolean().optional(), require_dnssec: z.boolean().optional(), require_mta_sts: z.boolean().optional(), require_caa: z.boolean().optional(), max_critical_findings: z.number().optional(), max_high_findings: z.number().optional() }).passthrough().describe('Policy baseline requirements.') } },
	{ name: 'generate_fix_plan', description: 'Generate a prioritised remediation plan from scan results.', params: DOMAIN_OPTIONAL },
	{ name: 'generate_spf_record', description: 'Generate an SPF record for a domain.', params: { domain: z.string(), include_providers: z.array(z.string()).max(15).optional().describe('Providers to include (e.g., ["google"]).'), format: z.enum(['full', 'compact']).optional() } },
	{ name: 'generate_dmarc_record', description: 'Generate a DMARC record for a domain.', params: { domain: z.string(), policy: z.enum(['none', 'quarantine', 'reject']).optional().describe('Policy (default "reject").'), rua_email: z.string().max(254).optional().describe('Report email. Default: dmarc-reports@{domain}.'), format: z.enum(['full', 'compact']).optional() } },
	{ name: 'generate_dkim_config', description: 'Generate DKIM configuration guidance.', params: { domain: z.string(), provider: z.string().max(100).optional().describe('Provider (e.g., "google"). Omit for generic.'), format: z.enum(['full', 'compact']).optional() } },
	{ name: 'generate_mta_sts_policy', description: 'Generate an MTA-STS policy for a domain.', params: { domain: z.string(), mx_hosts: z.array(z.string()).max(20).optional().describe('MX hosts. Omit to detect from DNS.'), format: z.enum(['full', 'compact']).optional() } },
	{ name: 'get_benchmark', description: 'Get score benchmarks: percentiles, mean, top failures.', params: { profile: z.enum(['mail_enabled', 'enterprise_mail', 'non_mail', 'web_only', 'minimal']).optional().describe('Profile to benchmark (default "mail_enabled").'), format: z.enum(['full', 'compact']).optional() } },
	{ name: 'get_provider_insights', description: 'Get provider cohort benchmarks and common issues.', params: { provider: z.string().min(1).describe('Provider (e.g., "google workspace").'), profile: z.enum(['mail_enabled', 'enterprise_mail', 'non_mail', 'web_only', 'minimal']).optional(), format: z.enum(['full', 'compact']).optional() } },
	{ name: 'explain_finding', description: 'Explain a specific security finding in detail.', params: { checkType: z.string().min(1).max(100).describe("Check type (e.g., 'SPF', 'DMARC')."), status: z.enum(['critical', 'high', 'medium', 'low', 'info', 'passed']).describe('Finding severity or status.'), details: z.string().max(2000).optional().describe('Additional detail from check result.'), format: z.enum(['full', 'compact']).optional() } },
	{ name: 'check_subdomailing', description: 'Detect SubdoMailing risk by analyzing SPF include chain for takeover-vulnerable domains.', params: DOMAIN_OPTIONAL },
	{ name: 'batch_scan', description: 'Scan up to 10 domains at once. Returns score, grade, and finding counts per domain.', params: { domains: z.array(z.string()).min(1).max(10).describe('Domains to scan (max 10)'), force_refresh: z.boolean().optional().describe('Bypass cache and run fresh scans.'), format: z.enum(['full', 'compact']).optional().describe('Output format') } },
	{ name: 'compare_domains', description: 'Side-by-side security comparison of 2-5 domains. Shows scores, category gaps, and unique weaknesses.', params: { domains: z.array(z.string()).min(2).max(5).describe('Domains to compare (2-5)'), format: z.enum(['full', 'compact']).optional().describe('Output format') } },
	{ name: 'map_supply_chain', description: 'Map third-party service dependencies from DNS records.', params: DOMAIN_OPTIONAL },
	{ name: 'analyze_drift', description: 'Compare current security posture against a previous baseline.', params: { domain: z.string().describe('Domain to analyze drift for'), baseline: z.string().min(1).max(50_000).describe('Previous ScanScore JSON or "cached"'), format: z.enum(['full', 'compact']).optional().describe('Output format') } },
	{ name: 'validate_fix', description: 'Re-check a specific control after applying a fix.', params: { domain: z.string().describe('Domain to validate the fix for'), check: z.string().describe('Check name to re-run (e.g., "dmarc", "spf")'), expected: z.string().max(1000).optional().describe('Expected DNS record value to verify against'), format: z.enum(['full', 'compact']).optional().describe('Output format') } },
	{ name: 'generate_rollout_plan', description: 'Generate a phased DMARC enforcement timeline with exact DNS records per phase.', params: { domain: z.string().describe('Domain to generate rollout plan for'), target_policy: z.enum(['quarantine', 'reject']).optional().describe('Target DMARC policy (default: reject)'), timeline: z.enum(['aggressive', 'standard', 'conservative']).optional().describe('Rollout speed (default: standard)'), format: z.enum(['full', 'compact']).optional().describe('Output format') } },
	{ name: 'resolve_spf_chain', description: 'Trace the full SPF include chain. Shows lookup count, tree depth, and circular includes.', params: DOMAIN_OPTIONAL },
	{ name: 'discover_subdomains', description: 'Find subdomains via Certificate Transparency logs.', params: DOMAIN_OPTIONAL },
	{ name: 'map_compliance', description: 'Map findings to NIST 800-177, PCI DSS 4.0, SOC 2, CIS Controls.', params: DOMAIN_OPTIONAL },
	{ name: 'simulate_attack_paths', description: 'Enumerate attack paths with severity, feasibility, steps, and mitigations.', params: DOMAIN_OPTIONAL },
	{ name: 'check_dbl', description: 'Check domain reputation against DNS-based Domain Block Lists.', params: DOMAIN_OPTIONAL },
	{ name: 'check_rbl', description: 'Check MX server IP reputation against Real-time Blocklists.', params: DOMAIN_OPTIONAL },
	{ name: 'cymru_asn', description: 'Map domain IPs to ASNs via Team Cymru DNS.', params: DOMAIN_OPTIONAL },
	{ name: 'rdap_lookup', description: 'Fetch domain registration data via RDAP (modern WHOIS).', params: DOMAIN_OPTIONAL },
	{ name: 'check_nsec_walkability', description: 'Assess DNSSEC zone walkability risk via NSEC3PARAM analysis.', params: DOMAIN_OPTIONAL },
	{ name: 'check_dnssec_chain', description: 'Walk the DNSSEC chain of trust from root to target domain.', params: DOMAIN_OPTIONAL },
	{ name: 'check_fast_flux', description: 'Detect fast-flux DNS behavior via multi-round A/AAAA queries.', params: { domain: z.string().describe('Domain to check (e.g., example.com)'), rounds: z.number().int().min(3).max(5).optional().describe('Number of query rounds (3-5, default 3)'), format: z.enum(['full', 'compact']).optional().describe('Output format') } },
];

// ---------------------------------------------------------------------------
// Main — register tools and connect immediately.
// ---------------------------------------------------------------------------

const server = new McpServer({
	name: 'Blackveil DNS',
	version: PROXY_VERSION,
});

for (const tool of TOOLS) {
	server.tool(tool.name, tool.description, tool.params, async (args) => {
		return callRemoteTool(tool.name, args as Record<string, unknown>);
	});
}

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[bv-proxy] Ready — ${TOOLS.length} tools, proxying to ${MCP_URL}`);
