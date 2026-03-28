# Blackveil DNS Security Scanner

A Claude Desktop Extension (MCP) that brings 33 DNS and email security tools directly into Claude — SPF, DMARC, DKIM, DNSSEC, SSL, CAA, MTA-STS, and more.

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
| `check_mx` | Inspect MX records and mail server configuration |
| `check_mx_reputation` | Assess mail server reputation |
| `check_ns` | Validate nameserver configuration |
| `check_ssl` | Check SSL/TLS certificate status and configuration |
| `check_caa` | Verify CAA (Certificate Authority Authorization) records |
| `check_dane` | Check DANE/TLSA records for SMTP |
| `check_dane_https` | Check DANE/TLSA records for HTTPS |
| `check_mta_sts` | Validate MTA-STS policy and configuration |
| `check_tlsrpt` | Check TLS-RPT reporting configuration |
| `check_bimi` | Validate BIMI (Brand Indicators for Message Identification) |
| `check_srv` | Inspect SRV records |
| `check_svcb_https` | Check SVCB/HTTPS DNS records |
| `check_txt_hygiene` | Audit TXT record hygiene |
| `check_zone_hygiene` | Audit DNS zone hygiene |
| `check_http_security` | Check HTTP security headers |
| `check_resolver_consistency` | Test resolver consistency across providers |
| `check_lookalikes` | Detect lookalike/typosquat domains |
| `check_shadow_domains` | Scan for shadow/subdomain takeover risks |
| `assess_spoofability` | Assess email spoofability risk |
| `explain_finding` | Get remediation guidance for a specific finding |
| `compare_baseline` | Compare domain config against a security baseline |
| `generate_spf_record` | Generate a recommended SPF record |
| `generate_dmarc_record` | Generate a recommended DMARC record |
| `generate_dkim_config` | Generate DKIM configuration guidance |
| `generate_mta_sts_policy` | Generate an MTA-STS policy |
| `generate_fix_plan` | Generate a prioritized remediation plan |
| `get_benchmark` | Get industry benchmark data |
| `get_provider_insights` | Get provider-specific security insights |

## Development

```bash
npm ci                 # Install dependencies
npm run build          # Bundle to dist/server.js
npm run dev            # Run the proxy locally
npm run typecheck      # TypeScript type check
npm run mcpb:validate  # Validate manifest
npm run mcpb:pack      # Build + pack .mcpb extension
```

## How It Works

The extension is a thin stdio-to-HTTP proxy. It reads JSON-RPC requests from stdin, forwards them to the hosted Blackveil DNS worker, and writes responses back to stdout. All DNS checks are performed remotely — the extension itself is stateless aside from session tracking.

## Release

Tag a version to trigger the CI pipeline:

```bash
git tag v1.0.1
git push origin v1.0.1
```

GitHub Actions will build the `.mcpb` file and publish it to Releases.

## License

[BUSL-1.1](LICENSE) — converts to Apache 2.0 four years after publication.

(c) 2025 BLACKVEIL Security
