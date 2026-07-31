export type ReservationStatus =
  | "confirmed"
  | "checked_in"
  | "checked_out"
  | "cancelled"
  | "no_show";

export type RoomStatus = "vacant_clean" | "vacant_dirty" | "occupied" | "out_of_order";

export interface Room {
  id: string;
  number: string;
  floor: number;
  type: "King" | "Twin" | "Suite";
  status: RoomStatus;
  rate: number;
  features: string[];
}

export interface Reservation {
  id: string;
  confirmation: string;
  guestName: string;
  email: string;
  arrival: string;
  departure: string;
  adults: number;
  infants: number;
  children: number;
  teens: number;
  seniors: number;
  roomType: Room["type"];
  roomProductId: string | null;
  ratePlanId: string | null;
  mealPlanId: string | null;
  roomId: string | null;
  status: ReservationStatus;
  source: "Direct" | "OTA" | "Corporate" | "Walk-in";
  balance: number;
  total: number;
  createdAt: string;
  version: number;
  priceExplanation: string[];
}

export interface FolioEntry {
  id: string;
  reservationId: string;
  kind: "charge" | "payment";
  code: string;
  description: string;
  amount: number;
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actor: string;
  reason: string;
  at: string;
  correlationId: string;
  summary: string;
}

export type AgeBand = "infant" | "child" | "teen" | "adult" | "senior";
export type MealPeriod = "breakfast" | "lunch" | "afternoon_tea" | "dinner" | "snacks" | "beverages";

export interface BedDefinition {
  type: "king" | "queen" | "double" | "twin" | "single" | "sofa_bed" | "bunk" | "crib" | "rollaway";
  quantity: number;
  sleeps: number;
  ageBands: AgeBand[];
}

export interface RoomProduct {
  id: string;
  code: string;
  name: string;
  category: "standard" | "deluxe" | "suite" | "family" | "accessible";
  roomType: Room["type"];
  description: string;
  maxOccupancy: Record<AgeBand, number>;
  beds: BedDefinition[];
  amenities: string[];
  accessible: boolean;
  baseRate: number;
}

export interface MealPlan {
  id: string;
  code: "RO" | "BB" | "HB" | "FB" | "AI";
  name: string;
  periods: MealPeriod[];
  adultPrice: number;
  childPrice: number;
}

export interface RateRule {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  adjustmentType: "percent" | "fixed";
  adjustment: number;
  minStay: number;
  promoCode: string | null;
  segment: string;
  active: boolean;
}

export interface RatePlan {
  id: string;
  code: string;
  name: string;
  mealPlanId: string;
  refundable: boolean;
  advancePurchaseDays: number;
  discountPercent: number;
  eligibleRoomProductIds: string[];
}

export interface Affiliate {
  id: string;
  code: string;
  name: string;
  commissionPercent: number;
  bookings: number;
  revenue: number;
  status: "active" | "paused";
}

export type ServiceCategory = "dining" | "wellness" | "entertainment" | "adventure" | "marine" | "guest_service";

export interface ServiceOffering {
  id: string;
  code: string;
  name: string;
  category: ServiceCategory;
  venue: string;
  durationMinutes: number;
  capacityPerSlot: number;
  price: number;
  minAge: number;
  riskLevel: "standard" | "controlled" | "high";
  requiresWaiver: boolean;
  slots: string[];
  active: boolean;
}

export interface ServiceBooking {
  id: string;
  serviceId: string;
  reservationId: string | null;
  guestName: string;
  serviceDate: string;
  slot: string;
  participants: number;
  status: "confirmed" | "completed" | "cancelled";
  total: number;
  createdAt: string;
}

export interface HousekeepingTask {
  id: string;
  roomId: string;
  type: "checkout_clean" | "stayover" | "inspection" | "deep_clean" | "linen" | "laundry" | "maintenance";
  priority: "urgent" | "high" | "normal";
  assignee: string;
  status: "queued" | "in_progress" | "inspection" | "completed";
  dueAt: string;
  notes: string;
}

export interface InventoryItem {
  id: string;
  sku: string;
  name: string;
  category: "food" | "beverage" | "linen" | "amenity" | "cleaning" | "engineering" | "retail";
  warehouse: string;
  unit: string;
  onHand: number;
  parLevel: number;
  reorderPoint: number;
  unitCost: number;
  valuation: "FIFO" | "weighted_average";
  expiryTracked: boolean;
}

export interface StockMovement {
  id: string;
  itemId: string;
  type: "receipt" | "issue" | "adjustment";
  quantity: number;
  unitCost: number;
  department: string;
  reference: string;
  createdAt: string;
}

export interface JournalLine {
  accountCode: string;
  accountName: string;
  costCenter: string;
  debit: number;
  credit: number;
}

export interface JournalEntry {
  id: string;
  journalNumber: string;
  businessDate: string;
  source: string;
  description: string;
  status: "posted" | "pending";
  lines: JournalLine[];
}

export interface GuestProfile {
  id: string;
  name: string;
  email: string;
  phone: string;
  loyaltyTier: "Member" | "Silver" | "Gold" | "Platinum";
  stays: number;
  lifetimeValue: number;
  consent: { email: boolean; sms: boolean; personalization: boolean };
  preferences: string[];
  dietaryNeeds: string[];
  tags: string[];
}

export interface Dashboard {
  businessDate: string;
  property: {
    id: string;
    name: string;
    code: string;
    timezone: string;
    currency: string;
  };
  metrics: {
    occupancy: number;
    arrivals: number;
    departures: number;
    inHouse: number;
    available: number;
    roomRevenue: number;
  };
  rooms: Room[];
  reservations: Reservation[];
  folios: FolioEntry[];
  audit: AuditEvent[];
  roomProducts: RoomProduct[];
  mealPlans: MealPlan[];
  ratePlans: RatePlan[];
  rateRules: RateRule[];
  affiliates: Affiliate[];
  services: ServiceOffering[];
  serviceBookings: ServiceBooking[];
  housekeepingTasks: HousekeepingTask[];
  inventoryItems: InventoryItem[];
  stockMovements: StockMovement[];
  journalEntries: JournalEntry[];
  guestProfiles: GuestProfile[];
}

export interface CreateReservationInput {
  guestName: string;
  email: string;
  arrival: string;
  departure: string;
  adults: number;
  infants: number;
  children: number;
  teens: number;
  seniors: number;
  roomProductId: string;
  ratePlanId: string;
  mealPlanId: string;
  promoCode?: string;
  source: Reservation["source"];
  idempotencyKey: string;
}
