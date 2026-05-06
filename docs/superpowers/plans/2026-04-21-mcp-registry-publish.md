# MCP Registry: How to Register & Publish a Server

> Research completed 2026-04-21. Sources: `github.com/modelcontextprotocol/registry` (main branch), official quickstart + authentication + remote-servers + package-types docs.

## Overview

The MCP Registry at `registry.modelcontextprotocol.io` is a community-driven **metadata-only** registry (like an app store index). It does **not** host artifacts — your server code lives on npm/PyPI/Docker/etc. The registry is in **preview** (API freeze v0.1 since 2025-10-24). Data resets may occur before GA.

---

## Step-by-Step: Zero to Published (DNS Domain Verification Path)

Since BlackVeil owns `blackveilsecurity.com`, DNS-based auth is the right path. This gives the server name the form `com.blackveilsecurity/dns-mcp` (reverse-DNS of your domain).

### 1. Install `mcp-publisher` CLI

```bash
# Homebrew (macOS)
brew install mcp-publisher

# OR binary download (macOS/Linux)
curl -L "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').tar.gz" | tar xz mcp-publisher && sudo mv mcp-publisher /usr/local/bin/

# Verify
mcp-publisher --version
```

CLI commands: `init`, `login`, `logout`, `publish`.

### 2. Generate Ed25519 Keypair + DNS TXT Record Value

```bash
MY_DOMAIN="blackveilsecurity.com"

# Generate key pair
openssl genpkey -algorithm Ed25519 -out key.pem

# Generate the TXT record value
PUBLIC_KEY="$(openssl pkey -in key.pem -pubout -outform DER | tail -c 32 | base64)"
echo "${MY_DOMAIN}. IN TXT \"v=MCPv1; k=ed25519; p=${PUBLIC_KEY}\""
```

This outputs something like:

```
blackveilsecurity.com. IN TXT "v=MCPv1; k=ed25519; p=BASE64_PUBLIC_KEY_HERE"
```

### 3. Add DNS TXT Record

Add a TXT record on `blackveilsecurity.com` via your DNS provider (Cloudflare):

| Type | Name | Content |
|------|------|---------|
| TXT  | `@` (or `blackveilsecurity.com`) | `v=MCPv1; k=ed25519; p=BASE64_PUBLIC_KEY_HERE` |

Wait for propagation (usually seconds on Cloudflare, up to minutes elsewhere).

### 4. Authenticate with the Registry

```bash
# Extract the private key hex and log in
PRIVATE_KEY="$(openssl pkey -in key.pem -noout -text | grep -A3 "priv:" | tail -n +2 | tr -d ' :\n')"
mcp-publisher login dns --domain "blackveilsecurity.com" --private-key "${PRIVATE_KEY}"
```

The CLI will:
1. Query the DNS TXT record on your domain for the public key
2. Verify your private key matches
3. Issue a signed JWT for subsequent publish calls

You should see: `Successfully authenticated!` / `✓ Successfully logged in`

### 5. Create `server.json`

```bash
# Auto-generate template (run from project root)
mcp-publisher init
```

Then edit `server.json`. For `bv-claude-dns` as a **remote MCP server**:

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "com.blackveilsecurity/dns-mcp",
  "title": "BlackVeil DNS Security Scanner",
  "description": "MCP server for DNS security scanning — checks DNSSEC, SPF, DKIM, DMARC, MX, CAA, DANE/TLSA, and more.",
  "version": "1.0.0",
  "repository": {
    "url": "https://github.com/anthropics/bv-claude-dns",
    "source": "github"
  },
  "remotes": [
    {
      "type": "streamable-http",
      "url": "https://dns-mcp.blackveilsecurity.com/mcp"
    }
  ]
}
```

Key rules:
- **`name`** MUST start with `com.blackveilsecurity/` (reverse-DNS of your verified domain).
- **`remotes`** — use for servers accessible over HTTP (not stdio). Supports `streamable-http` (recommended) or `sse` transport types.
- **`version`** — must be updated for each publish.

### 6. Publish

```bash
mcp-publisher publish
```

The registry validates:
- Your JWT is valid (from `login` step)
- The server name matches your verified domain namespace
- The remote URL is publicly accessible
- Schema is valid

### 7. Verify on Registry

Visit `https://registry.modelcontextprotocol.io` and search for your server name.

---

## Alternative: GitHub-Based Auth (Simpler, but `io.github.*` namespace)

If you prefer not to do DNS verification:

```bash
mcp-publisher login github
# Opens browser OAuth flow → enter device code → done
```

Server name must be `io.github.YOUR_USERNAME/server-name` (not custom domain).

---

## Alternative: HTTP-Based Auth (`.well-known` file)

Instead of DNS TXT record, host a file:

```bash
# Generate the file content
PUBLIC_KEY="$(openssl pkey -in key.pem -pubout -outform DER | tail -c 32 | base64)"
echo "v=MCPv1; k=ed25519; p=${PUBLIC_KEY}" > mcp-registry-auth
```

Host at: `https://blackveilsecurity.com/.well-known/mcp-registry-auth`

Then:
```bash
PRIVATE_KEY="$(openssl pkey -in key.pem -noout -text | grep -A3 "priv:" | tail -n +2 | tr -d ' :\n')"
mcp-publisher login http --domain "blackveilsecurity.com" --private-key "${PRIVATE_KEY}"
```

---

## CI/CD: GitHub Actions Automation

For automated publishing on tag push, use OIDC auth (recommended) or PAT:

```yaml
# .github/workflows/publish-mcp.yml
name: Publish to MCP Registry
on:
  push:
    tags: ["v*"]
jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v5
      - name: Install mcp-publisher
        run: |
          curl -L "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').tar.gz" | tar xz mcp-publisher
      - name: Authenticate to MCP Registry
        run: ./mcp-publisher login github-oidc
      - name: Publish server to MCP Registry
        run: ./mcp-publisher publish
```

---

## Package Ownership Verification (if also publishing npm/PyPI package)

| Package Type | Verification Method |
|---|---|
| **npm** | Add `"mcpName": "com.blackveilsecurity/dns-mcp"` to `package.json` |
| **PyPI** | Add `<!-- mcp-name: com.blackveilsecurity/dns-mcp -->` comment in README |
| **Docker** | Add `LABEL io.modelcontextprotocol.name="com.blackveilsecurity/dns-mcp"` |
| **NuGet** | `mcp-name` tag in `.csproj`, or comment in README |
| **Crate** | `<!-- mcp-name: ... -->` comment in README |

---

## Key Facts

- **No `@modelcontextprotocol/publisher` npm package exists.** The CLI is a Go binary distributed via GitHub Releases and Homebrew.
- **The registry repo** is at `github.com/modelcontextprotocol/registry` (Go, 6.7k stars, active).
- **`key.pem` is the verification token** — the Ed25519 private key proves domain ownership. The public key goes into DNS TXT. Keep `key.pem` safe and out of version control.
- **Supported algorithms**: Ed25519 (recommended) or ECDSA P-384.
- **Cloud KMS support**: Azure Key Vault, Google Cloud KMS, and AWS KMS can be used instead of local `key.pem` files for DNS auth.

---

## Concrete Action Items for BlackVeil

1. `brew install mcp-publisher`
2. Generate Ed25519 keypair → get DNS TXT record value
3. Add TXT record to `blackveilsecurity.com` in Cloudflare DNS
4. `mcp-publisher login dns --domain blackveilsecurity.com --private-key "..."`
5. Create `server.json` with `remotes` pointing to `dns-mcp.blackveilsecurity.com`
6. `mcp-publisher publish`
7. Optionally add GitHub Actions workflow for automated re-publish on version tags
