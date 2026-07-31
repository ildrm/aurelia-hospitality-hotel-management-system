# Requirements Traceability

| Requirement | Capability | Evidence | Implementation | Acceptance |
| --- | --- | --- | --- | --- |
| INV-001 no unintended double sale | Inventory | Product invariant | `shared/rules.ts`, reservation transaction | overlapping assigned room is excluded |
| RES-001 idempotent creation | Reservation | Product invariant | API idempotency key | same key returns same reservation |
| STAY-001 controlled check-in | Stay | Hotel workflow | check-in command | confirmed stay + clean room becomes in-house |
| LED-001 append-only postings | Ledger | Accounting invariant | folio entries | balance derives from immutable entries |
| PAY-001 no raw card data | Payments | E-002 | token-only contract | payload schema rejects card data |
| AUD-001 trace state changes | Audit | Product invariant | audit event transaction | actor, time, entity, correlation, reason present |
| DATE-001 controlled business date | Night audit | Hotel workflow | audit command | exceptions block close; successful close advances one day |
| UX-001 accessible operations UI | Design system | E-001 | semantic React UI | keyboard focus, labels, non-color status |
| IAM-001 staff authentication required | Identity | Security baseline | hashed-password session login | anonymous dashboard returns 401 |
| IAM-002 role authorization | Identity | Authorization matrix | shared permission model plus API checks | denied role/action returns 403 |
| IAM-003 scoped data response | Identity | Tenant/property invariant | property-bound queries and response minimization | inaccessible domains are omitted |
| IAM-004 server-owned audit actor | Audit | Audit invariant | actor resolved from session | request payload cannot select actor |
| CAT-001 room and bed product definition | Catalog | Book ch. 11 plus requested extension | room products with beds, amenities, accessibility, and age-band capacity | catalog and booking flow expose the selected configuration |
| BOARD-001 board basis on reservation | Reservations / Dining | Book ch. 11 and ch. 13 | RO, BB, HB, FB, and AI meal plans with explicit meal periods and age-sensitive prices | reservation snapshot identifies meals and calculated charge |
| REV-001 conditional and seasonal pricing | Revenue | Book ch. 6 | rate plans and date/segment/promo rules with minimum stays | server price explanation identifies every applied condition |
| AFF-001 affiliate performance | Distribution | Book ch. 7 | affiliate code, commission, booking, revenue, and status model | authorized revenue/accounting roles receive affiliate data |
| HK-001 housekeeping task lifecycle | Housekeeping | Book ch. 16 | assigned task board with clean/inspect/maintenance/laundry types | completion of cleaning/inspection releases an eligible room clean |
| WH-001 perpetual stock control | Warehouse | Book ch. 15 | receipt/issue movements, par and reorder levels, negative-stock guard | every movement updates on-hand and creates a balanced journal |
| ACC-001 double-entry journal | Accounting | Book ch. 8 | journal headers and debit/credit lines | generated entry is rejected unless debits equal credits |
| CRM-001 guest profile and consent | CRM | Book CRM and guest relationship coverage | stay/value metrics, preferences, tags, review score, consent flag | CRM updates require `crm.update` and property scope |
| SVC-001 capacity-controlled ancillary booking | Activities / Dining | Book ch. 12 and ch. 13 | venue, slot, capacity, age, waiver, commission, and folio link | invalid slot/age/waiver/capacity requests are rejected transactionally |

Status values: planned, foundation, implemented slice, validated.
