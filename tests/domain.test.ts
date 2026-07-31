import { describe, expect, it } from "vitest";
import {
  availableRooms,
  calculateReservationPrice,
  calculateStayTotal,
  journalBalances,
  meetsAdvancePurchase,
  nightsBetween,
  overlaps,
  projectedOnHand,
  validateAgeCapacity
} from "../shared/rules";
import type { RateRule, Reservation, Room } from "../shared/domain";
import { rolePermissions } from "../shared/auth";

const rooms: Room[] = [
  { id: "king-1", number: "101", floor: 1, type: "King", status: "vacant_clean", rate: 200, features: [] },
  { id: "king-2", number: "102", floor: 1, type: "King", status: "out_of_order", rate: 200, features: [] },
  { id: "twin-1", number: "103", floor: 1, type: "Twin", status: "vacant_clean", rate: 160, features: [] }
];

const reservation: Reservation = {
  id: "res-1",
  confirmation: "AUR-1",
  guestName: "Test Guest",
  email: "test@example.com",
  arrival: "2026-08-01",
  departure: "2026-08-04",
  adults: 2,
  infants: 0,
  children: 0,
  teens: 0,
  seniors: 0,
  roomType: "King",
  roomProductId: "rp_grand_king",
  ratePlanId: "rate_flex_bb",
  mealPlanId: "meal_bb",
  roomId: "king-1",
  status: "confirmed",
  source: "Direct",
  balance: 0,
  total: 660,
  createdAt: "2026-07-31T00:00:00.000Z",
  version: 1,
  priceExplanation: []
};

describe("stay date rules", () => {
  it("uses half-open stay intervals so same-day turnover does not overlap", () => {
    expect(overlaps("2026-08-01", "2026-08-04", "2026-08-04", "2026-08-06")).toBe(false);
    expect(overlaps("2026-08-01", "2026-08-04", "2026-08-03", "2026-08-06")).toBe(true);
  });

  it("counts calendar room nights and rejects invalid stays", () => {
    expect(nightsBetween("2026-08-01", "2026-08-04")).toBe(3);
    expect(calculateStayTotal(200, "2026-08-01", "2026-08-04")).toBe(660);
    expect(() => calculateStayTotal(200, "2026-08-01", "2026-08-01")).toThrow(
      "Departure must be after arrival"
    );
  });
});

describe("inventory authority", () => {
  it("excludes overlapping assigned inventory and out-of-order rooms", () => {
    expect(availableRooms(rooms, [reservation], "King", "2026-08-02", "2026-08-03")).toEqual([]);
  });

  it("releases inventory after checkout and honors room-type boundaries", () => {
    const checkedOut = { ...reservation, status: "checked_out" as const };
    expect(availableRooms(rooms, [checkedOut], "King", "2026-08-02", "2026-08-03").map((r) => r.id)).toEqual(["king-1"]);
    expect(availableRooms(rooms, [], "Twin", "2026-08-02", "2026-08-03").map((r) => r.id)).toEqual(["twin-1"]);
  });
});

describe("role permissions", () => {
  it("separates operational duties instead of granting a shared panel role", () => {
    expect(rolePermissions.front_desk).toContain("reservation.checkin");
    expect(rolePermissions.front_desk).not.toContain("audit.run");
    expect(rolePermissions.housekeeping).toContain("room.update");
    expect(rolePermissions.housekeeping).not.toContain("reservation.read");
    expect(rolePermissions.night_auditor).toContain("audit.run");
    expect(rolePermissions.night_auditor).not.toContain("payment.capture");
    expect(rolePermissions.accountant).toContain("payment.capture");
    expect(rolePermissions.accountant).not.toContain("stay.checkout");
    expect(rolePermissions.inventory_manager).toContain("inventory.update");
    expect(rolePermissions.inventory_manager).not.toContain("rate.update");
    expect(rolePermissions.revenue_manager).toContain("rate.update");
    expect(rolePermissions.revenue_manager).not.toContain("accounting.post");
    expect(rolePermissions.crm_manager).toContain("crm.update");
    expect(rolePermissions.crm_manager).not.toContain("inventory.update");
    expect(rolePermissions.activities_manager).toContain("service.book");
    expect(rolePermissions.activities_manager).not.toContain("housekeeping.update");
  });

  it("reserves the complete permission set for the general manager", () => {
    const granted = new Set(Object.values(rolePermissions).flat());
    expect(new Set(rolePermissions.general_manager)).toEqual(granted);
  });
});

describe("commercial and operational rules", () => {
  const winterRule: RateRule = {
    id: "rr-winter",
    name: "Winter escape",
    startDate: "2026-11-01",
    endDate: "2027-02-28",
    adjustmentType: "percent",
    adjustment: -12,
    minStay: 2,
    promoCode: "WINTER12",
    segment: "Leisure",
    active: true
  };

  it("prices room, age-sensitive meals, discount, seasonal rule, and tax deterministically", () => {
    const result = calculateReservationPrice({
      arrival: "2026-11-20",
      departure: "2026-11-22",
      baseRate: 205,
      productCode: "GKG",
      ratePlanName: "Advance saver",
      rateDiscountPercent: 15,
      mealPlanCode: "HB",
      mealPlanName: "Half board",
      mealPeriods: ["breakfast", "dinner"],
      adultMealPrice: 58,
      childMealPrice: 29,
      adultMealGuests: 2,
      childMealGuests: 1,
      promoCode: "winter12",
      source: "Direct",
      rules: [winterRule],
      taxRate: 0.1
    });

    expect(result.total).toBe(656.35);
    expect(result.appliedRuleIds).toEqual(["rr-winter"]);
    expect(result.explanation).toContain("Winter escape");
  });

  it("does not apply a rate rule before its minimum stay", () => {
    const result = calculateReservationPrice({
      arrival: "2026-11-20",
      departure: "2026-11-21",
      baseRate: 205,
      productCode: "GKG",
      ratePlanName: "Flexible",
      rateDiscountPercent: 0,
      mealPlanCode: "RO",
      mealPlanName: "Room only",
      mealPeriods: [],
      adultMealPrice: 0,
      childMealPrice: 0,
      adultMealGuests: 2,
      childMealGuests: 0,
      promoCode: "WINTER12",
      source: "Direct",
      rules: [winterRule],
      taxRate: 0.1
    });

    expect(result.total).toBe(225.5);
    expect(result.appliedRuleIds).toEqual([]);
  });

  it("validates age-band occupancy independently", () => {
    const capacity = { infant: 1, child: 2, teen: 2, adult: 2, senior: 1 };
    expect(validateAgeCapacity(capacity, { infant: 1, child: 2, teen: 1, adult: 2, senior: 1 })).toEqual([]);
    expect(validateAgeCapacity(capacity, { infant: 2, child: 2, teen: 1, adult: 3, senior: 1 })).toEqual([
      "infant:2>1",
      "adult:3>2"
    ]);
  });

  it("projects stock and validates double-entry balance", () => {
    expect(projectedOnHand(10, "receipt", 4)).toBe(14);
    expect(projectedOnHand(10, "issue", 4)).toBe(6);
    expect(journalBalances([{ debit: 130, credit: 0 }, { debit: 0, credit: 130 }])).toBe(true);
    expect(journalBalances([{ debit: 130, credit: 0 }, { debit: 0, credit: 129.99 }])).toBe(false);
  });

  it("enforces the advance-purchase window against the property business date", () => {
    expect(meetsAdvancePurchase("2026-08-21", "2026-07-31", 21)).toBe(true);
    expect(meetsAdvancePurchase("2026-08-20", "2026-07-31", 21)).toBe(false);
  });
});
