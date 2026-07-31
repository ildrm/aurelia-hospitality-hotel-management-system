# ADR-001: Transactional Modular Monolith

- Status: Accepted for foundation
- Date: 2026-07-31

## Context

Reservation, room-night inventory, folio, and payment orchestration require explicit consistency and reconciliation. The initial team and traffic profile do not justify independent services for every capability.

## Decision

Use a modular monolith with strict context APIs and one transactional relational store for the critical path. Commands write business state, audit records, and outbox messages in one database transaction. Read models may be denormalized. External integrations consume versioned outbox events. Contexts can be extracted after ownership, availability, security isolation, or scaling evidence exists.

SQLite provides a zero-setup local executable. PostgreSQL-compatible storage is required for production so row locking, constraints, PITR, replicas, and operational tooling can be validated.

## Consequences

- Core invariants can be enforced atomically.
- Deployment and debugging remain manageable.
- Module boundaries require architecture tests and ownership review.
- SQLite is not evidence of production concurrency behavior; PostgreSQL race and failover tests are release gates.
- Cross-context consumers must tolerate at-least-once event delivery.
