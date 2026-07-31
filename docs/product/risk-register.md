# Risk Register

| Risk | Impact | Control | Exit evidence |
| --- | --- | --- | --- |
| Inventory race | Oversell/guest walk | database constraint, transaction, version, reconciliation | PostgreSQL concurrency test |
| Payment timeout after capture | Duplicate charge | provider idempotency, intent state, reconciliation | fault-injection test |
| Tax/fiscal variance | Invalid invoice | effective-dated adapter, legal review | market certification |
| Tenant scope omission | Data breach | query scoping, policy middleware, isolation tests | independent penetration test |
| Night audit interruption | incorrect business date | checkpoints, lease, restart | restart test at every checkpoint |
| Partner replay | duplicate reservation | signed payload, inbox key | contract replay test |
| Frontline workflow friction | service delay | role UAT, telemetry, keyboard paths | timed hotel-role usability test |
| Scope dilution | shallow modules | traceability and vertical-slice gates | definition-of-done review |
