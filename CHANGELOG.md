# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [2.9.1] - 2026-04-21

### Added
- **18 new tools** — proxy now exposes all 51 tools matching bv-mcp parity: `check_subdomailing`, `batch_scan`, `compare_domains`, `map_supply_chain`, `analyze_drift`, `validate_fix`, `generate_rollout_plan`, `resolve_spf_chain`, `discover_subdomains`, `map_compliance`, `simulate_attack_paths`, `check_dbl`, `check_rbl`, `cymru_asn`, `rdap_lookup`, `check_nsec_walkability`, `check_dnssec_chain`, `check_fast_flux`
- **Manifest expanded to 51 tools** — directory listing now shows the full tool set
- **Privacy policy** — `privacy_policy` field added to manifest.json
- **Drift protection test** — Vitest test ensures manifest-to-runtime tool parity and version sync
- **CHANGELOG.md** — this file

### Changed
- **Version aligned to bv-mcp** — jumped from 1.1.1 to 2.9.1 to stay in sync with the upstream server

## [1.1.1] - 2026-03-31

### Added
- SHA256SUMS.txt published alongside .mcpb in GitHub Releases for download integrity verification

## [1.1.0] - 2026-03-28

### Added
- User-Agent header sent with all remote requests
- Version sync script keeps manifest.json and package.json aligned

### Fixed
- All tool schemas aligned with remote Worker

## [1.0.1] - 2026-03-24

### Fixed
- Handle unresolved MCPB user_config placeholder for free-tier users
- Request timeout (30s) and response size limit (2 MB)
- Removed API key logging

### Security
- Pre-commit hook and gitleaks config for secret/IP leak prevention
- Gitleaks secret scan and dependency audit CI workflow

## [1.0.0] - 2026-03-20

### Added
- Initial release — stdio-to-HTTPS proxy for Blackveil DNS MCP server
- 33 tools for DNS and email security scanning
- Optional API key configuration via MCPB user_config
- GitHub Actions CI pipeline for .mcpb builds on version tags
