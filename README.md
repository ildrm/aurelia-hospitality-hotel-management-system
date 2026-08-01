# Aurelia Hospitality

A transaction-focused hotel management system covering reservations, front desk, room and bed products, board basis, revenue rules, affiliate channels, housekeeping, perpetual inventory, accounting, guest CRM, and bookable ancillary and recreational services.

## Run locally

```powershell
npm install
npm run dev
```

Open `http://localhost:4173`. The API and built client are served by the same Node process. Local data is seeded into `data/aurelia.db`.

The login screen includes training accounts for General Manager, Front Desk, Reservations, Housekeeping, Night Audit, Accounting, Inventory, Revenue, CRM, and Ancillary & Venue Management. Their shared local-only training password is `Aurora2026!`. Each account receives a different server-enforced permission set documented in [`docs/security/authorization-matrix.md`](docs/security/authorization-matrix.md).

## Validate

```powershell
npm run typecheck
npm test
npm run build
```

Product scope, explicit assumptions, architecture decisions, invariants, research evidence, risks, and traceability live in [`docs/`](docs/).
