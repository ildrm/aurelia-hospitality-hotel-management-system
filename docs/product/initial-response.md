# Initial Product Interpretation

## Executive interpretation

The requested product is a composable hospitality operating platform, not a dashboard. Its critical path is a transactionally safe reservation-to-ledger workflow that preserves inventory, payment, tax, and audit invariants while supporting multiple properties and operating roles. Delivery is therefore staged: establish evidence, language, ownership, security, and architecture first; then add complete vertical slices.

## Assumptions and non-goals

- The first executable increment serves one tenant and one seeded property, while every authoritative record carries tenant/property scope.
- The initial deployment is a modular monolith. Domain boundaries are explicit and may be extracted only when load, ownership, or isolation justifies it.
- A payment provider token is modeled; raw cardholder data is never collected or stored.
- Tax is a versioned demonstration policy of 10%, not a jurisdiction-ready fiscal implementation.
- English/LTR is implemented first. The design system and layout are RTL-ready; translations require property-specific validation.
- Phase 0/1 and the Phase 2 critical path are in scope for this increment. Distribution, POS, procurement, CRM, RMS, loyalty, and specialized lodging remain planned.
- No claim of vendor parity, regulatory certification, PCI compliance, or production readiness is made without independent validation.

## Verification plan

Claims are classified as verified fact, vendor claim, convention, recommendation, or hypothesis. Primary sources are recorded with retrieval date. Competitor cells default to `Requires Current Verification` until a primary source has been reviewed. Legal, tax, fiscal, privacy, accessibility, and payment behavior require market-specific counsel or a qualified assessor.

## Capability map

1. Platform: tenant, organization, property, identity, authorization, configuration, audit.
2. Commerce: catalog, CRS, availability, pricing, reservation, IBE, distribution, ABS.
3. Stay: front desk, rooms, keys, folio, payments, night audit.
4. Operations: housekeeping, maintenance, service requests, transport.
5. Commercial: CRM, loyalty, groups, sales, events, revenue management.
6. Retail: POS, spa, activities, ancillary inventory.
7. Back office: procurement, stock, accounting, tax, treasury, owner accounting.
8. Intelligence: reporting, data platform, optimization, explainable AI.
9. Ecosystem: APIs, webhooks, adapters, developer portal, migration tooling.

## Property archetypes

- Small independent: simple inventory, owner/operator workflows, local payments.
- Full-service city hotel: rooms, groups, POS, events, direct bill, night audit.
- Resort: distributed outlets, activities, spa, transport, packages, complex folios.
- Extended stay: recurring charges, lease-like rules, long-stay housekeeping.
- Hostel: bed inventory, shared occupancy, age and gender policies where lawful.
- Vacation rental: unit owners, trust accounting, channel-heavy distribution.
- Enterprise chain: central CRS, governance inheritance, shared services, data residency.

## Primary personas and workflows

| Persona | Top workflow |
| --- | --- |
| Front desk agent | Find arrival, assign room, verify, check in, post, settle, check out |
| Reservations agent | Search, quote, hold, guarantee, confirm, amend, cancel |
| Night auditor | Resolve exceptions, post room/tax, close date, reconcile |
| Housekeeping supervisor | Prioritize rooms, dispatch, inspect, release |
| Revenue manager | Review demand, price, restrictions, publish with approval |
| Accountant | Reconcile postings/payments, correct by reversal, export journals |
| General manager | Monitor service, occupancy, revenue, risk, and approvals |
| Guest | Shop transparently, book, verify, manage stay, settle |

## Bounded contexts and ownership

| Context | Owns |
| --- | --- |
| Platform | tenants, properties, business date, configuration |
| Identity | principals, roles, policies, grants, sessions |
| Catalog | room types, units, attributes, sellable products |
| Reservation | quotes, holds, reservations, occupants |
| Inventory | stay-date capacity, allocations, availability decisions |
| Stay | assignments, arrivals, in-house state, room moves |
| Ledger | folios, postings, routing, tax snapshots |
| Payments | provider intents, authorizations, captures, refunds |
| Audit | append-only business/security events |
| Night audit | business-date close process and checkpoints |

## Architecture options

| Option | Strength | Cost |
| --- | --- | --- |
| Modular monolith | Atomic core transactions, low operational overhead | Requires disciplined module boundaries |
| Service-oriented core | Independent scaling and isolation | Distributed consistency and operating cost arrive early |
| Serverless functions | Elastic edge/API workloads | Poor fit for multi-step transactional orchestration without added infrastructure |

Recommendation: a modular monolith with PostgreSQL-compatible production storage, SQLite for the local executable, an outbox, versioned REST contracts, and extraction seams. See ADR-001.

## Critical invariants

1. A room-night is not committed twice beyond an explicit authorized sell limit.
2. Quote total and tax policy are snapshotted and reproducible.
3. Create/reserve/pay commands require an idempotency key.
4. Reservation transitions follow an explicit state machine and optimistic version.
5. A checked-in stay has one assigned operationally sellable room.
6. Ledger entries are append-only; corrections use compensating entries.
7. Every financial transaction balances and carries currency.
8. Gateway uncertainty is reconciled before a retry can create another charge.
9. Business date changes only through a restartable, checkpointed audit.
10. State changes emit actor, scope, reason, correlation ID, and before/after reference.

## Security and compliance baseline

OIDC/OAuth authentication, tenant/property-scoped authorization, deny-by-default policy, MFA for privileged roles, secure cookies, CSRF protection, CSP, validation at trust boundaries, rate limits, encrypted transport/storage, secret rotation, append-only audit, log redaction, signed webhooks, dependency/SAST scanning, backups, restore tests, and incident runbooks. PCI scope is minimized through hosted payment fields and provider tokens. WCAG 2.2 AA is the UI target.

## Initial SLO proposal

| Capability | Target |
| --- | --- |
| Front-desk reads | p95 < 750 ms, 99.9% monthly |
| Availability search | p95 < 1.5 s, 99.95% monthly |
| Reservation confirmation | p95 < 3 s excluding provider latency, 99.95% |
| Payment orchestration | p95 < 5 s excluding challenge, 99.95% |
| Room status update | p95 < 1 s, 99.9% |
| Webhook delivery | 99% within 60 s, durable retry for 72 h |
| RPO/RTO core ledger | <= 5 min / <= 60 min, validated by restore test |

## Roadmap and first slice

Phase 0 defines evidence, capability union, personas, language, roadmap, and risk. Phase 1 establishes tenancy, authorization, canonical models, invariants, conventions, CI, security, and tests. The first executable Phase 2 slice is: configure seeded property and rooms; search availability; create an idempotent reservation; assign/check in; post folio charges and tokenized payment; check out; run night audit; inspect audit history. Later phases follow the source specification and enter the traceability matrix before coding.

## Repository structure

```text
docs/       product, research, architecture, security, operations
shared/     transport-neutral contracts and domain rules
server/     API, transactional store, application workflows
src/        role-based operations client and design system
tests/      domain and workflow tests
data/       ignored local database
```

## Stack and alternatives

TypeScript, React, Vite, Node HTTP, Zod, SQLite locally, and PostgreSQL in production. A durable broker is deferred until more than one deployable consumes the outbox. Alternatives considered: Next.js for public booking SEO, Java/Kotlin or .NET for a larger enterprise team, and Kafka when measured throughput/retention requires it.

## Test strategy

Domain invariant tests precede API workflow tests. The release portfolio adds database migrations, permissions and tenant isolation, booking races, payment idempotency, ledger balance, restartable audit, contract, accessibility, localization/RTL, browser, load, backup/restore, security, and hotel-role UAT tests.

## Key risks

Regulatory variance; tax/fiscal complexity; partner certification; payment uncertainty; inventory races; overbroad early scope; data migration quality; cross-tenant leakage; offline conflict; operational usability; and unverifiable vendor comparisons. Each requires an owner, control, evidence, and exit criterion in the risk register.

## Non-blocking questions recorded as assumptions

Target launch markets, payment/acquiring partners, fiscal adapters, channel partners, data regions, property archetype priority, availability SLO, and deployment cloud remain product decisions. The executable uses a generic full-service hotel and provider-neutral interfaces so those choices do not block foundation work.
