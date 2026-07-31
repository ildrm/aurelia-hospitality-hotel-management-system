# Security Baseline

## Trust boundaries

The browser, partner adapters, payment provider, identity provider, and property-edge devices are untrusted boundaries. Every command is authenticated in production, authorized by tenant/property/action policy, schema-validated, correlation-scoped, rate-limited, and audited.

## Foundation controls

- Local training authentication uses scrypt password hashes, opaque expiring sessions, CSRF protection, and server-enforced role/property permissions. Production replaces password login with the configured identity provider.
- Deny-by-default RBAC/ABAC with tenant and property scope in policy input.
- OIDC authorization code flow with PKCE; MFA and short privileged sessions.
- Hosted payment fields and opaque provider tokens; prohibited card data is rejected and never logged.
- Parameterized SQL, request body limits, output encoding, CSP, no-store operational responses.
- CSRF tokens for cookie sessions; SameSite/HttpOnly/Secure session cookies.
- Provider idempotency keys and webhook signature/timestamp/replay validation.
- Encryption in transit and at rest, managed keys, rotation, and secret inventory.
- Structured, PII-minimized telemetry and append-only audit records.
- SAST, dependency, secret, container, IaC, DAST, tenant-isolation, and authorization tests in CI.

## Known foundation gaps

The local executable deliberately omits a real identity provider, payment gateway, WAF/rate-limit layer, malware scanning, managed key service, and PostgreSQL row-lock validation. These are production release gates, not implied by the demo login identity.
