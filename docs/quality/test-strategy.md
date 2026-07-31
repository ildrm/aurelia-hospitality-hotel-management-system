# Risk-based Test Strategy

## Release gates

1. Domain: reservation state machine, half-open stay dates, tax snapshots, ledger balance.
2. Persistence: migrations forward/back, constraints, transaction rollback, outbox atomicity.
3. Concurrency: last-room booking, overlapping assignment, duplicate/replayed commands.
4. Payments: timeout after provider capture, idempotent retry, refund/reversal reconciliation.
5. Authorization: action and query scope, cross-tenant/property attempts, privileged approval.
6. Night audit: each checkpoint interruption, lease contention, restart, repeat invocation.
7. UI: keyboard-only common workflows, focus management, screen reader semantics, WCAG 2.2 AA automated and manual review.
8. Localization: date/number/currency, long translations, RTL, timezone and DST boundary.
9. Resilience: partner outage, queue delay, disk/database failure, restore, degraded mode.
10. Hotel-role UAT: timed reservation, arrival, move, settlement, room clean, and audit scenarios.

## Canonical first-slice scenarios

- Direct and partner commands compete for the last sellable room-night.
- Payment provider captures but the client times out.
- Check-in selects a dirty, mismatched, occupied, or overlapping room.
- Checkout is attempted with a non-zero folio.
- Room is released dirty only after successful checkout.
- Night audit is attempted with due-out stays still in house.
- Duplicate reservation/payment idempotency keys return one business result.
