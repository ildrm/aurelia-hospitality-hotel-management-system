# Modern Hotel Management Systems - Compliance Audit

Source: *Modern Hotel Management Systems: A Global Guide to Operations, Strategy, and Sustainable Tourism*, 1st edition, HEXA, May 2025. Local PDF reviewed 2026-07-31. The book is an educational reference and explicitly disclaims completeness, accuracy guarantees, and professional advice. This matrix therefore records traceability, not certification or "scientific compliance."

## Relevant evidence

| Book location | Supported requirement | Product interpretation |
| --- | --- | --- |
| Chapter 6, PDF pp. 117-127 | Forecasting, dynamic pricing, segmentation, rate restrictions, packages, ancillary revenue, RevPAR/TRevPAR | Effective-dated rate plans, seasonal modifiers, discounts, restrictions, rate explanation |
| Chapter 7, PDF pp. 128-137 | Affiliate profiles, tracking links/codes, commissions, attribution, partner performance | Affiliate master, commission rule, booking attribution, payable status |
| Chapter 8, PDF pp. 138-158 | USALI-oriented accounting, chart of accounts, GL/AP/AR, budgets, audit, integration | Balanced journals, cost centers, ledgers, source trace, controlled posting |
| Chapter 11, PDF pp. 189-198 | Room/service reservation ecosystem, availability, packages, add-ons, room types | Canonical room product, occupancy, meal plan, package and add-on selection |
| Chapter 12, PDF pp. 199-207 | Tours, spa, golf, entertainment, tickets, capacity, time slots, resources, suppliers, commissions | Unified bookable-service catalog and capacity-safe booking workflow |
| Chapter 13, PDF pp. 208-217 | Restaurants, coffee shops, clubs, table inventory, meal periods, waitlists, POS/PMS/CRM integration | Dining/venue offerings, meal-period reservations, folio charge linkage |
| Chapter 15, PDF pp. 229-238 | Perpetual inventory, FIFO, par, reorder point, receiving, requisition/issue, counts, variance | Warehouse/item master, receive/issue movements, on-hand and reorder alerts |
| Chapter 16, PDF pp. 239-249 | Clean/dirty/inspected/OOO, assignments, mobile tasks, laundry/linen, lost and found, work orders | Housekeeping task board with priority, assignee, room, status and service type |
| Chapters 4, 11, 13 and 19 | Guest history, preferences, dietary needs, consent and personalized service | Property-scoped guest profile, consent, preferences, loyalty and spend summary |

## User-requested domain extensions

The following are valid product requirements but are not specified in enough detail by the reviewed book to serve as an implementation standard:

- Bed taxonomy by physical type and age suitability.
- Explicit infant, child, teen, adult, and senior occupancy bands.
- Photography, pool, laundry, massage, disco, club, concert, show, cinema, sailing, bungee jumping, paragliding, and cruise inventory as named SKUs.
- Jurisdiction-specific tax/fiscal accounting and safety/waiver rules for high-risk activities.

These are implemented as configurable catalog concepts. Age limits, medical/safety eligibility, waivers, tax, capacity, and operating rules remain property/jurisdiction configuration requiring qualified review.

## Gap assessment before this increment

| Capability | Previous state | Required state |
| --- | --- | --- |
| Room products and bed composition | Room type string only | Product master, room attributes, bed composition, age capacity |
| Meals | Not modeled | RO/BB/HB/FB/AI plus explicit included meal periods |
| Pricing | One room base rate | Effective seasons, rate plans, special discounts, restrictions, affiliates |
| Ancillary services | Not modeled | Resource/capacity-aware catalog and bookings linked to guest/stay |
| Housekeeping | Room-status button only | Task assignment, service type, priority, lifecycle and room synchronization |
| Warehouse | Not modeled | Item master, par/reorder, on-hand, receive/issue and movement audit |
| Accounting | Folio only | Balanced journal view, accounts, cost centers and source trace |
| CRM | Reservation name/email only | Profile, consent, loyalty, preferences, tags and spend/stay summary |
| Authorization | Five core pages | Permissions and role navigation for every added domain |

## Acceptance position

This increment is conformant to the listed book-derived requirements only where the traceability matrix says `Implemented` and tests exist. It does not claim full coverage of all 53 chapters, regulatory certification, or final production readiness.
