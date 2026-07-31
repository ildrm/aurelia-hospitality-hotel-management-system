# Authorization Matrix

The server is the authority for every permission. The client derives navigation, pages, buttons, and modal actions from the same permission vocabulary, while `/api/dashboard` removes collections the session may not read. A hidden control is therefore never the security boundary.

| Role | Operational scope | Explicit exclusions |
| --- | --- | --- |
| General Manager | Complete permission set across the property | None |
| Front Desk Manager | Reservations, check-in/out, rooms, folios, payments, catalog/rates read, services, housekeeping read, CRM read | Night audit, accounting journals, rate administration, inventory movements, CRM editing |
| Reservations Agent | Reservation create/read, rooms/catalog/rates read, services booking, CRM read | Check-in/out, folios/payments, room status, accounting, inventory movements |
| Housekeeping Supervisor | Rooms and housekeeping read/update, inventory read | Guest reservations, rates, folios, payments, accounting, CRM |
| Night Auditor | Reservations/rooms/folios read, night audit, housekeeping/inventory/accounting read | Booking creation, payments, operational updates, journal posting |
| Hotel Accountant | Reservations/folios/audit/inventory/accounting/affiliates read, folio/payment and journal posting | Check-in/out, room/housekeeping updates, rates, CRM editing |
| Inventory Manager | Inventory read/update, housekeeping and accounting read | Reservations, rates, payments, journal posting, CRM |
| Revenue Manager | Reservations/catalog/rates/services/affiliates read, rate and affiliate administration | Stay operations, payments, housekeeping, inventory, accounting, CRM editing |
| CRM Manager | Reservations/services/affiliates read, CRM read/update | Stay operations, rates, housekeeping, inventory, accounting |
| Ancillary & Venue Manager | Reservations/CRM read, services read/book | Stay operations, rates, housekeeping, inventory, accounting, CRM editing |

## Enforcement path

1. Every panel request requires a valid opaque session cookie.
2. Every state-changing request also requires the session-bound CSRF token.
3. The route calls `requirePermission` before reading its scoped resource or opening a transaction.
4. Queries bind the authenticated user's `propertyId`; actor and property values never come from request bodies.
5. Dashboard collections are filtered through `scopeDashboard`, so a role cannot retrieve hidden module data through the aggregate endpoint.
6. The React shell calls `can(user, permission)` for navigation, page selection, buttons, and dialogs.

## Session controls

- Passwords are salted and hashed with scrypt.
- The browser receives an opaque 256-bit session token in an HttpOnly, SameSite=Strict cookie.
- Only the SHA-256 digest of the session token is stored.
- Sessions expire after eight hours and are invalidated on logout.
- Login attempts are rate-limited per normalized email and network address.
- Authentication failures use a uniform response to avoid account enumeration.
