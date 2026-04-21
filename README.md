# Blackveil DNS Security Scanner

A Claude Desktop Extension (MCP) that brings 51 DNS and email security tools directly into Claude — SPF, DMARC, DKIM, DNSSEC, SSL, CAA, MTA-STS, and more.

![Blackveil DNS](assets/icon.png)

## Install

Download the latest `.mcpb` file from [GitHub Releases](https://github.com/MadaBurns/bv-claude-dns/releases) and open it with Claude Desktop.

## Configuration

| Setting | Required | Description |
|---------|----------|-------------|
| `API Key` | No | Your Blackveil API key. Get one at [blackveilsecurity.com](https://blackveilsecurity.com) |

## Tools

| Tool | Description |
|------|-------------|
| `scan_domain` | Full DNS and email security audit — score, grade, maturity, findings |
| `check_spf` | Validate SPF syntax, policy, and trust surface |
| `check_dmarc` | Validate DMARC policy, alignment, and reporting |
| `check_dkim` | Probe DKIM selectors and validate key strength |
| `check_dnssec` | Verify DNSSEC validation and DNSKEY/DS records |
| `check_mx` | Validate MX records and email provider detection |
| `check_ssl` | Verify SSL/TLS certificate and HTTPS config |
| `check_mta_sts` | Validate MTA-STS SMTP encryption policy |
| `check_ns` | Analyze NS delegation and provider diversity |
| `check_caa` | Check authorized Certificate Authorities via CAA |
| `check_bimi` | Validate BIMI record and VMC evidence |
| `check_tlsrpt` | Validate TLS-RPT SMTP failure reporting |
| `check_http_security` | Audit HTTP security headers (CSP, COOP, etc.) |
| `check_dane` | Verify DANE/TLSA certificate pinning |
| `check_dane_https` | Verify DANE certificate pinning for HTTPS |
| `check_svcb_https` | Validate HTTPS/SVCB records (RFC 9460) |
| `check_lookalikes` | Detect active typosquat/lookalike domains |
| `check_shadow_domains` | Detect shadow/subdomain takeover risks |
| `check_subdomailing` | Detect SubdoMailing risk via SPF include chain |
| `check_txt_hygiene` | Audit TXT record hygiene and accumulation |
| `check_mx_reputation` | Check MX server IP reputation via DNSBLs |
| `check_srv` | Discover SRV records for common services |
| `check_zone_hygiene` | Audit DNS zone configuration hygiene |
| `check_resolver_consistency` | Compare DNS responses across resolvers |
| `check_dbl` | Check domain reputation against Domain Block Lists |
| `check_rbl` | Check MX server IP reputation against Blocklists |
| `check_nsec_walkability` | Assess DNSSEC zone walkability risk |
| `check_dnssec_chain` | Walk the DNSSEC chain of trust from root |
| `check_fast_flux` | Detect fast-flux DNS behavior |
| `cymru_asn` | Map domain IPs to ASNs via Team Cymru DNS |
| `rdap_lookup` | Fetch domain registration data via RDAP |
| `assess_spoofability` | Assess email spoofing risk for a domain |
| `explain_finding` | Get remediation guidance for a specific finding |
| `compare_baseline` | Compare domain config against a security baseline |
| `compare_domains` | Side-by-side security comparison of 2-5 domains |
| `batch_scan` | Scan up to 10 domains at once |
| `map_supply_chain` | Map third-party service dependencies from DNS |
| `analyze_drift` | Compare current posture against a previous baseline |
| `resolve_spf_chain` | Trace the full SPF include chain |
| `discover_subdomains` | Find subdomains via Certificate Transparency logs |
| `map_compliance` | Map findings to NIST, PCI DSS, SOC 2, CIS Controls |
| `simulate_attack_paths` | Enumerate attack paths with severity and mitigations |
| `generate_fix_plan` | Generate a prioritized remediation plan |
| `generate_spf_record` | Generate a recommended SPF record |
| `generate_dmarc_record` | Generate a recommended DMARC record |
| `generate_dkim_config` | Generate DKIM configuration guidance |
| `generate_mta_sts_policy` | Generate an MTA-STS policy |
| `generate_rollout_plan` | Generate a phased DMARC enforcement timeline |
| `validate_fix` | Re-check a control after applying a fix |
| `get_benchmark` | Get industry benchmark data |
| `get_provider_insights` | Get provider-specific security insights |

## Example prompts

Try these with the Blackveil DNS extension enabled in Claude Desktop:

| Prompt | What it does |
|--------|-------------|
| `Scan blackveilsecurity.com and tell me what needs fixing` | Full security audit — score, grade, prioritized findings |
| `Compare the email security of google.com and microsoft.com` | Side-by-side comparison of two domains' postures |
| `Generate a DMARC record for example.com with reject policy` | Produces a ready-to-publish DNS record |
| `What attack paths exist for example.com?` | Enumerates spoofing, takeover, and hijack vectors |
| `Map example.com's compliance against NIST 800-177` | Maps findings to compliance framework controls |

## Support

- **Bug reports & feature requests:** [GitHub Issues](https://github.com/MadaBurns/bv-claude-dns/issues)
- **Security vulnerabilities:** [security@blackveilsecurity.com](mailto:security@blackveilsecurity.com)
- **Upstream MCP server:** [MadaBurns/bv-mcp](https://github.com/MadaBurns/bv-mcp/issues)

## Development

```bash
npm ci                 # Install dependencies
npm run build          # Bundle to dist/server.js
npm run dev            # Run the proxy locally
npm test               # Run tests
npm run typecheck      # TypeScript type check
npm run mcpb:validate  # Validate manifest
npm run mcpb:pack      # Build + pack .mcpb extension
```

## How It Works

The extension is a thin stdio-to-HTTP proxy. It reads JSON-RPC requests from stdin, forwards them to the hosted Blackveil DNS worker, and writes responses back to stdout. All DNS checks are performed remotely — the extension itself is stateless aside from session tracking.

## Release

Tag a version to trigger the CI pipeline:

```bash
git tag v2.9.1
git push origin v2.9.1
```

GitHub Actions will build the `.mcpb` file and publish it to Releases.

## Legal

- [Privacy Policy](https://www.blackveilsecurity.com/privacy)
- [License](LICENSE) — BUSL-1.1, converts to Apache 2.0 four years after publication

(c) 2025 BLACKVEIL Security
