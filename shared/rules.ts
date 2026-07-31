import type { AgeBand, RateRule, Reservation, Room, RoomProduct } from "./domain";

export function nightsBetween(arrival: string, departure: string): number {
  const start = Date.parse(`${arrival}T00:00:00Z`);
  const end = Date.parse(`${departure}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

export function meetsAdvancePurchase(arrival: string, businessDate: string, requiredDays: number): boolean {
  return nightsBetween(businessDate, arrival) >= requiredDays;
}

export function overlaps(
  arrivalA: string,
  departureA: string,
  arrivalB: string,
  departureB: string
): boolean {
  return arrivalA < departureB && arrivalB < departureA;
}

export function availableRooms(
  rooms: Room[],
  reservations: Reservation[],
  roomType: Room["type"],
  arrival: string,
  departure: string
): Room[] {
  const blocked = new Set(
    reservations
      .filter(
        (reservation) =>
          reservation.roomId &&
          !["cancelled", "checked_out", "no_show"].includes(reservation.status) &&
          overlaps(arrival, departure, reservation.arrival, reservation.departure)
      )
      .map((reservation) => reservation.roomId)
  );

  return rooms.filter(
    (room) =>
      room.type === roomType &&
      room.status !== "out_of_order" &&
      !blocked.has(room.id)
  );
}

export function calculateStayTotal(rate: number, arrival: string, departure: string): number {
  const nights = nightsBetween(arrival, departure);
  if (nights < 1) throw new Error("Departure must be after arrival");
  return Math.round(rate * nights * 1.1 * 100) / 100;
}

export function validateAgeCapacity(
  capacity: RoomProduct["maxOccupancy"],
  requested: Record<AgeBand, number>
): string[] {
  return (Object.keys(requested) as AgeBand[])
    .filter((band) => requested[band] > capacity[band])
    .map((band) => `${band}:${requested[band]}>${capacity[band]}`);
}

export interface ReservationPriceInput {
  arrival: string;
  departure: string;
  baseRate: number;
  productCode: string;
  ratePlanName: string;
  rateDiscountPercent: number;
  mealPlanCode: string;
  mealPlanName: string;
  mealPeriods: string[];
  adultMealPrice: number;
  childMealPrice: number;
  adultMealGuests: number;
  childMealGuests: number;
  promoCode?: string;
  source: Reservation["source"];
  rules: RateRule[];
  taxRate: number;
}

export function calculateReservationPrice(input: ReservationPriceInput) {
  const nights = nightsBetween(input.arrival, input.departure);
  if (nights < 1) throw new Error("Departure must be after arrival");
  const explanation = [`${nights} night(s) x ${input.baseRate.toFixed(2)} ${input.productCode}`];
  const appliedRuleIds: string[] = [];
  let roomSubtotal = 0;
  for (let offset = 0; offset < nights; offset++) {
    const date = new Date(`${input.arrival}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    const stayDate = date.toISOString().slice(0, 10);
    let nightly = input.baseRate * (1 - input.rateDiscountPercent / 100);
    for (const rule of input.rules) {
      if (!rule.active || nights < rule.minStay || stayDate < rule.startDate || stayDate > rule.endDate) continue;
      const codeMatches = rule.promoCode?.toUpperCase() === input.promoCode?.toUpperCase();
      const segmentMatches = rule.segment === "Corporate" && input.source === "Corporate";
      if (rule.promoCode && !codeMatches && !segmentMatches) continue;
      nightly = rule.adjustmentType === "percent"
        ? nightly * (1 + rule.adjustment / 100)
        : nightly + rule.adjustment;
      if (!appliedRuleIds.includes(rule.id)) {
        appliedRuleIds.push(rule.id);
        explanation.push(rule.name);
      }
    }
    roomSubtotal += nightly;
  }
  if (input.rateDiscountPercent) explanation.push(`${input.ratePlanName}: ${input.rateDiscountPercent}% discount`);
  const mealSubtotal = nights * (
    input.adultMealGuests * input.adultMealPrice + input.childMealGuests * input.childMealPrice
  );
  explanation.push(`${input.mealPlanCode} ${input.mealPlanName}: ${input.mealPeriods.join(", ") || "no meals"}`);
  const pretax = roomSubtotal + mealSubtotal;
  const tax = Math.round(pretax * input.taxRate * 100) / 100;
  const total = Math.round((pretax + tax) * 100) / 100;
  explanation.push(`Tax snapshot: ${(input.taxRate * 100).toFixed(0)}% · total ${total.toFixed(2)}`);
  return { nights, roomSubtotal, mealSubtotal, pretax, tax, total, appliedRuleIds, explanation };
}

export function projectedOnHand(onHand: number, type: "receipt" | "issue", quantity: number): number {
  return onHand + (type === "receipt" ? quantity : -quantity);
}

export function journalBalances(lines: Array<{ debit: number; credit: number }>): boolean {
  const debit = lines.reduce((sum, line) => sum + line.debit, 0);
  const credit = lines.reduce((sum, line) => sum + line.credit, 0);
  return Math.abs(debit - credit) < 0.005;
}
