import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdirSync, existsSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { z, ZodError } from "zod";
import { calculateReservationPrice, journalBalances, meetsAdvancePurchase, projectedOnHand, validateAgeCapacity } from "../shared/rules";
import type {
  Affiliate, Dashboard, GuestProfile, HousekeepingTask, InventoryItem, JournalEntry,
  MealPlan, RatePlan, RateRule, Reservation, Room, RoomProduct, ServiceBooking,
  ServiceOffering, StockMovement
} from "../shared/domain";
import { roleLabels, rolePermissions, type AuthSession, type AuthUser, type Permission, type Role } from "../shared/auth";

const PORT = Number(process.env.PORT ?? 4173);
const ROOT = resolve(import.meta.dirname, "..");
const DATA_DIR = join(ROOT, "data");
mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(join(DATA_DIR, "aurelia.db"));
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");

const DEMO_PASSWORD = "Aurora2026!";

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, expectedHex] = stored.split(":");
  if (!salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const sessionKey = (token: string) => createHash("sha256").update(token).digest("hex");

const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const plusDays = (base: string, days: number) => {
  const date = new Date(`${base}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
};

function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS property (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      timezone TEXT NOT NULL,
      currency TEXT NOT NULL,
      business_date TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS room (
      id TEXT PRIMARY KEY,
      property_id TEXT NOT NULL REFERENCES property(id),
      number TEXT NOT NULL,
      floor INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('King', 'Twin', 'Suite')),
      status TEXT NOT NULL CHECK(status IN ('vacant_clean', 'vacant_dirty', 'occupied', 'out_of_order')),
      rate REAL NOT NULL CHECK(rate >= 0),
      features_json TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      UNIQUE(property_id, number)
    );
    CREATE TABLE IF NOT EXISTS reservation (
      id TEXT PRIMARY KEY,
      property_id TEXT NOT NULL REFERENCES property(id),
      confirmation TEXT NOT NULL UNIQUE,
      guest_name TEXT NOT NULL,
      email TEXT NOT NULL,
      arrival TEXT NOT NULL,
      departure TEXT NOT NULL,
      adults INTEGER NOT NULL CHECK(adults > 0),
      room_type TEXT NOT NULL,
      room_id TEXT REFERENCES room(id),
      status TEXT NOT NULL,
      source TEXT NOT NULL,
      total REAL NOT NULL,
      created_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      idempotency_key TEXT NOT NULL UNIQUE,
      CHECK(arrival < departure)
    );
    CREATE TABLE IF NOT EXISTS folio_entry (
      id TEXT PRIMARY KEY,
      reservation_id TEXT NOT NULL REFERENCES reservation(id),
      kind TEXT NOT NULL CHECK(kind IN ('charge', 'payment')),
      code TEXT NOT NULL,
      description TEXT NOT NULL,
      amount REAL NOT NULL CHECK(amount > 0),
      created_at TEXT NOT NULL,
      idempotency_key TEXT UNIQUE
    );
    CREATE TABLE IF NOT EXISTS audit_event (
      id TEXT PRIMARY KEY,
      property_id TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      actor TEXT NOT NULL,
      reason TEXT NOT NULL,
      at TEXT NOT NULL,
      correlation_id TEXT NOT NULL,
      summary TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS outbox (
      id TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      published_at TEXT
    );
    CREATE TABLE IF NOT EXISTS user_account (
      id TEXT PRIMARY KEY,
      property_id TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS user_session (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
      csrf_token TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reservation_dates ON reservation(property_id, arrival, departure);
    CREATE INDEX IF NOT EXISTS idx_reservation_room ON reservation(room_id, status);
    CREATE INDEX IF NOT EXISTS idx_folio_reservation ON folio_entry(reservation_id);
    CREATE INDEX IF NOT EXISTS idx_audit_property_at ON audit_event(property_id, at DESC);
    CREATE INDEX IF NOT EXISTS idx_session_expiry ON user_session(expires_at);
  `);

  const demoUsers: Array<[string, string, string, Role]> = [
    ["user_gm", "Leila Farzan", "gm@aurora.test", "general_manager"],
    ["user_frontdesk", "Mina Shah", "frontdesk@aurora.test", "front_desk"],
    ["user_reservations", "Daniel Kim", "reservations@aurora.test", "reservations"],
    ["user_housekeeping", "Samira Noor", "housekeeping@aurora.test", "housekeeping"],
    ["user_auditor", "Owen Park", "auditor@aurora.test", "night_auditor"],
    ["user_accountant", "Priya Nair", "accountant@aurora.test", "accountant"],
    ["user_inventory", "Tariq Aziz", "inventory@aurora.test", "inventory_manager"],
    ["user_revenue", "Elena Rossi", "revenue@aurora.test", "revenue_manager"],
    ["user_crm", "Nora Ellis", "crm@aurora.test", "crm_manager"],
    ["user_activities", "Marco Silva", "activities@aurora.test", "activities_manager"]
  ];
  const insertUser = db.prepare(`
    INSERT OR IGNORE INTO user_account (id, property_id, name, email, password_hash, role)
    VALUES (?, 'prop_aurora', ?, ?, ?, ?)
  `);
  for (const user of demoUsers) insertUser.run(user[0], user[1], user[2], hashPassword(DEMO_PASSWORD), user[3]);

  const propertyCount = Number(
    (db.prepare("SELECT COUNT(*) AS count FROM property").get() as { count: number }).count
  );
  if (propertyCount > 0) {
    const roomCount = Number((db.prepare("SELECT COUNT(*) AS count FROM room").get() as { count: number }).count);
    if (roomCount > 0) return;
    // Recover only an interrupted first-run seed where no operational records exist.
    db.prepare("DELETE FROM property WHERE id = 'prop_aurora'").run();
  }

  const today = isoDate(new Date());
  db.exec("BEGIN");
  try {
    db.prepare(
      "INSERT INTO property VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run("prop_aurora", "tenant_demo", "The Aurora Grand", "AUR-01", "Asia/Tehran", "USD", today);

    const rooms: Array<[string, string, number, Room["type"], Room["status"], number, string[]]> = [
      ["room_201", "201", 2, "King", "vacant_clean", 185, ["City view", "King bed"]],
      ["room_202", "202", 2, "Twin", "vacant_clean", 165, ["Courtyard view", "Twin beds"]],
      ["room_203", "203", 2, "King", "vacant_dirty", 185, ["Accessible", "Walk-in shower"]],
      ["room_204", "204", 2, "Suite", "vacant_clean", 290, ["Corner suite", "Sofa bed"]],
      ["room_301", "301", 3, "King", "occupied", 205, ["High floor", "City view"]],
      ["room_302", "302", 3, "Twin", "occupied", 175, ["High floor", "Twin beds"]],
      ["room_303", "303", 3, "King", "out_of_order", 205, ["High floor", "Quiet zone"]],
      ["room_304", "304", 3, "Suite", "vacant_clean", 315, ["Panoramic view", "Living room"]],
      ["room_401", "401", 4, "King", "vacant_clean", 220, ["High floor", "Club access"]],
      ["room_402", "402", 4, "Twin", "vacant_clean", 190, ["High floor", "Club access"]],
      ["room_403", "403", 4, "King", "vacant_clean", 220, ["Accessible", "Club access"]],
      ["room_404", "404", 4, "Suite", "vacant_clean", 340, ["Presidential floor", "Dining room"]]
    ];
    const insertRoom = db.prepare(
      "INSERT INTO room (id, property_id, number, floor, type, status, rate, features_json) VALUES (?, 'prop_aurora', ?, ?, ?, ?, ?, ?)"
    );
    for (const room of rooms) insertRoom.run(room[0], room[1], room[2], room[3], room[4], room[5], JSON.stringify(room[6]));

    const now = new Date().toISOString();
    const reservations = [
      ["res_amina", "AUR-24081", "Amina Rahimi", "amina@example.com", today, plusDays(today, 3), 2, "King", "room_301", "checked_in", "Direct", 676.5, "seed-amina"],
      ["res_noah", "AUR-24082", "Noah Bennett", "noah@example.com", today, plusDays(today, 2), 1, "Twin", "room_202", "confirmed", "Corporate", 363, "seed-noah"],
      ["res_sofia", "AUR-24083", "Sofia Martinez", "sofia@example.com", today, plusDays(today, 1), 2, "Suite", "room_204", "confirmed", "OTA", 319, "seed-sofia"],
      ["res_liam", "AUR-24079", "Liam Chen", "liam@example.com", plusDays(today, -2), today, 2, "Twin", "room_302", "checked_in", "Direct", 385, "seed-liam"],
      ["res_maya", "AUR-24084", "Maya Okafor", "maya@example.com", plusDays(today, 1), plusDays(today, 4), 2, "King", "room_401", "confirmed", "OTA", 610.5, "seed-maya"]
    ];
    const insertReservation = db.prepare(`
      INSERT INTO reservation
      (id, property_id, confirmation, guest_name, email, arrival, departure, adults, room_type, room_id, status, source, total, created_at, idempotency_key)
      VALUES (?, 'prop_aurora', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of reservations) insertReservation.run(...row.slice(0, 12), now, row[12]);

    const insertEntry = db.prepare(
      "INSERT INTO folio_entry VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );
    insertEntry.run("fe_amina_room", "res_amina", "charge", "ROOM", "Room and tax - night 1", 225.5, now, "seed-fe-1");
    insertEntry.run("fe_amina_deposit", "res_amina", "payment", "VISA", "Deposit · token ending 4242", 200, now, "seed-fe-2");
    insertEntry.run("fe_liam_room", "res_liam", "charge", "ROOM", "Room and tax - 2 nights", 385, now, "seed-fe-3");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

initializeDatabase();

function initializeExtendedDatabase() {
  const reservationColumns = new Set((db.prepare("PRAGMA table_info(reservation)").all() as Array<{ name: string }>).map((column) => column.name));
  const ensureReservationColumn = (name: string, definition: string) => {
    if (!reservationColumns.has(name)) db.exec(`ALTER TABLE reservation ADD COLUMN ${name} ${definition}`);
  };
  ensureReservationColumn("room_product_id", "TEXT");
  ensureReservationColumn("rate_plan_id", "TEXT");
  ensureReservationColumn("meal_plan_id", "TEXT");
  ensureReservationColumn("infants", "INTEGER NOT NULL DEFAULT 0");
  ensureReservationColumn("children", "INTEGER NOT NULL DEFAULT 0");
  ensureReservationColumn("teens", "INTEGER NOT NULL DEFAULT 0");
  ensureReservationColumn("seniors", "INTEGER NOT NULL DEFAULT 0");
  ensureReservationColumn("price_explanation_json", "TEXT NOT NULL DEFAULT '[]'");
  db.exec(`
    CREATE TABLE IF NOT EXISTS room_product (
      id TEXT PRIMARY KEY, property_id TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL,
      category TEXT NOT NULL, room_type TEXT NOT NULL, description TEXT NOT NULL,
      max_occupancy_json TEXT NOT NULL, beds_json TEXT NOT NULL, amenities_json TEXT NOT NULL,
      accessible INTEGER NOT NULL, base_rate REAL NOT NULL, UNIQUE(property_id, code)
    );
    CREATE TABLE IF NOT EXISTS meal_plan (
      id TEXT PRIMARY KEY, property_id TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL,
      periods_json TEXT NOT NULL, adult_price REAL NOT NULL, child_price REAL NOT NULL,
      UNIQUE(property_id, code)
    );
    CREATE TABLE IF NOT EXISTS rate_plan (
      id TEXT PRIMARY KEY, property_id TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL,
      meal_plan_id TEXT NOT NULL, refundable INTEGER NOT NULL, advance_purchase_days INTEGER NOT NULL,
      discount_percent REAL NOT NULL, eligible_room_products_json TEXT NOT NULL, UNIQUE(property_id, code)
    );
    CREATE TABLE IF NOT EXISTS rate_rule (
      id TEXT PRIMARY KEY, property_id TEXT NOT NULL, name TEXT NOT NULL, start_date TEXT NOT NULL,
      end_date TEXT NOT NULL, adjustment_type TEXT NOT NULL, adjustment REAL NOT NULL,
      min_stay INTEGER NOT NULL, promo_code TEXT, segment TEXT NOT NULL, active INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS affiliate (
      id TEXT PRIMARY KEY, property_id TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL,
      commission_percent REAL NOT NULL, bookings INTEGER NOT NULL, revenue REAL NOT NULL,
      status TEXT NOT NULL, UNIQUE(property_id, code)
    );
    CREATE TABLE IF NOT EXISTS service_offering (
      id TEXT PRIMARY KEY, property_id TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL,
      category TEXT NOT NULL, venue TEXT NOT NULL, duration_minutes INTEGER NOT NULL,
      capacity_per_slot INTEGER NOT NULL, price REAL NOT NULL, min_age INTEGER NOT NULL,
      risk_level TEXT NOT NULL, requires_waiver INTEGER NOT NULL, slots_json TEXT NOT NULL,
      active INTEGER NOT NULL, UNIQUE(property_id, code)
    );
    CREATE TABLE IF NOT EXISTS service_booking (
      id TEXT PRIMARY KEY, property_id TEXT NOT NULL, service_id TEXT NOT NULL,
      reservation_id TEXT, guest_name TEXT NOT NULL, service_date TEXT NOT NULL, slot TEXT NOT NULL,
      participants INTEGER NOT NULL, status TEXT NOT NULL, total REAL NOT NULL, created_at TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS housekeeping_task (
      id TEXT PRIMARY KEY, property_id TEXT NOT NULL, room_id TEXT NOT NULL, type TEXT NOT NULL,
      priority TEXT NOT NULL, assignee TEXT NOT NULL, status TEXT NOT NULL, due_at TEXT NOT NULL,
      notes TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS inventory_item (
      id TEXT PRIMARY KEY, property_id TEXT NOT NULL, sku TEXT NOT NULL, name TEXT NOT NULL,
      category TEXT NOT NULL, warehouse TEXT NOT NULL, unit TEXT NOT NULL, on_hand REAL NOT NULL,
      par_level REAL NOT NULL, reorder_point REAL NOT NULL, unit_cost REAL NOT NULL,
      valuation TEXT NOT NULL, expiry_tracked INTEGER NOT NULL, UNIQUE(property_id, sku)
    );
    CREATE TABLE IF NOT EXISTS stock_movement (
      id TEXT PRIMARY KEY, property_id TEXT NOT NULL, item_id TEXT NOT NULL, type TEXT NOT NULL,
      quantity REAL NOT NULL, unit_cost REAL NOT NULL, department TEXT NOT NULL,
      reference TEXT NOT NULL, created_at TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS journal_entry (
      id TEXT PRIMARY KEY, property_id TEXT NOT NULL, journal_number TEXT NOT NULL,
      business_date TEXT NOT NULL, source TEXT NOT NULL, description TEXT NOT NULL,
      status TEXT NOT NULL, lines_json TEXT NOT NULL, UNIQUE(property_id, journal_number)
    );
    CREATE TABLE IF NOT EXISTS guest_profile (
      id TEXT PRIMARY KEY, property_id TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL,
      phone TEXT NOT NULL, loyalty_tier TEXT NOT NULL, stays INTEGER NOT NULL,
      lifetime_value REAL NOT NULL, consent_json TEXT NOT NULL, preferences_json TEXT NOT NULL,
      dietary_json TEXT NOT NULL, tags_json TEXT NOT NULL, UNIQUE(property_id, email)
    );
    CREATE INDEX IF NOT EXISTS idx_service_booking_slot ON service_booking(property_id, service_id, service_date, slot);
    CREATE INDEX IF NOT EXISTS idx_housekeeping_status ON housekeeping_task(property_id, status, due_at);
    CREATE INDEX IF NOT EXISTS idx_stock_movement_item ON stock_movement(property_id, item_id, created_at);
  `);

  const roomProducts: RoomProduct[] = [
    { id: "rp_grand_king", code: "GKG", name: "Grand King", category: "deluxe", roomType: "King", description: "City-view king room with work lounge and optional infant crib.", maxOccupancy: { infant: 1, child: 1, teen: 1, adult: 2, senior: 2 }, beds: [{ type: "king", quantity: 1, sleeps: 2, ageBands: ["adult", "senior"] }, { type: "crib", quantity: 1, sleeps: 1, ageBands: ["infant"] }], amenities: ["City view", "Walk-in shower", "Work lounge"], accessible: false, baseRate: 205 },
    { id: "rp_twin_club", code: "TWC", name: "Club Twin", category: "deluxe", roomType: "Twin", description: "Two separate beds with club access, suited to adults, teens, or seniors.", maxOccupancy: { infant: 1, child: 2, teen: 2, adult: 2, senior: 2 }, beds: [{ type: "twin", quantity: 2, sleeps: 1, ageBands: ["child", "teen", "adult", "senior"] }], amenities: ["Twin beds", "Club access", "High floor"], accessible: false, baseRate: 190 },
    { id: "rp_family", code: "FAM", name: "Family Residence", category: "family", roomType: "Suite", description: "Family layout with queen bed, child/teen bunks, and infant crib.", maxOccupancy: { infant: 1, child: 2, teen: 2, adult: 2, senior: 1 }, beds: [{ type: "queen", quantity: 1, sleeps: 2, ageBands: ["adult", "senior"] }, { type: "bunk", quantity: 1, sleeps: 2, ageBands: ["child", "teen"] }, { type: "crib", quantity: 1, sleeps: 1, ageBands: ["infant"] }], amenities: ["Kitchenette", "Bunk alcove", "Dining table"], accessible: false, baseRate: 315 },
    { id: "rp_accessible_suite", code: "ACS", name: "Accessible Corner Suite", category: "accessible", roomType: "Suite", description: "Step-free suite with accessible bathroom and flexible sofa bed.", maxOccupancy: { infant: 1, child: 2, teen: 2, adult: 3, senior: 3 }, beds: [{ type: "king", quantity: 1, sleeps: 2, ageBands: ["adult", "senior"] }, { type: "sofa_bed", quantity: 1, sleeps: 1, ageBands: ["child", "teen", "adult"] }], amenities: ["Step-free route", "Roll-in shower", "Visual alarm"], accessible: true, baseRate: 340 }
  ];
  const insertRoomProduct = db.prepare("INSERT OR IGNORE INTO room_product VALUES (?, 'prop_aurora', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const item of roomProducts) insertRoomProduct.run(item.id, item.code, item.name, item.category, item.roomType, item.description, JSON.stringify(item.maxOccupancy), JSON.stringify(item.beds), JSON.stringify(item.amenities), Number(item.accessible), item.baseRate);

  const mealPlans: MealPlan[] = [
    { id: "meal_ro", code: "RO", name: "Room only", periods: [], adultPrice: 0, childPrice: 0 },
    { id: "meal_bb", code: "BB", name: "Bed & breakfast", periods: ["breakfast"], adultPrice: 24, childPrice: 12 },
    { id: "meal_hb", code: "HB", name: "Half board", periods: ["breakfast", "dinner"], adultPrice: 58, childPrice: 29 },
    { id: "meal_fb", code: "FB", name: "Full board", periods: ["breakfast", "lunch", "afternoon_tea", "dinner"], adultPrice: 88, childPrice: 44 },
    { id: "meal_ai", code: "AI", name: "All inclusive", periods: ["breakfast", "lunch", "afternoon_tea", "dinner", "snacks", "beverages"], adultPrice: 125, childPrice: 62.5 }
  ];
  const insertMeal = db.prepare("INSERT OR IGNORE INTO meal_plan VALUES (?, 'prop_aurora', ?, ?, ?, ?, ?)");
  for (const item of mealPlans) insertMeal.run(item.id, item.code, item.name, JSON.stringify(item.periods), item.adultPrice, item.childPrice);

  const ratePlans: RatePlan[] = [
    { id: "rate_flex_bb", code: "FLEX-BB", name: "Flexible breakfast", mealPlanId: "meal_bb", refundable: true, advancePurchaseDays: 0, discountPercent: 0, eligibleRoomProductIds: roomProducts.map((item) => item.id) },
    { id: "rate_advance", code: "ADV-21", name: "Advance saver", mealPlanId: "meal_ro", refundable: false, advancePurchaseDays: 21, discountPercent: 15, eligibleRoomProductIds: roomProducts.map((item) => item.id) },
    { id: "rate_family", code: "FAMILY-HB", name: "Family half board", mealPlanId: "meal_hb", refundable: true, advancePurchaseDays: 0, discountPercent: 8, eligibleRoomProductIds: ["rp_family"] },
    { id: "rate_resort", code: "RESORT-AI", name: "Resort all inclusive", mealPlanId: "meal_ai", refundable: true, advancePurchaseDays: 7, discountPercent: 5, eligibleRoomProductIds: ["rp_family", "rp_accessible_suite"] }
  ];
  const insertRatePlan = db.prepare("INSERT OR IGNORE INTO rate_plan VALUES (?, 'prop_aurora', ?, ?, ?, ?, ?, ?, ?)");
  for (const item of ratePlans) insertRatePlan.run(item.id, item.code, item.name, item.mealPlanId, Number(item.refundable), item.advancePurchaseDays, item.discountPercent, JSON.stringify(item.eligibleRoomProductIds));

  const rateRules: RateRule[] = [
    { id: "rr_summer", name: "Summer demand", startDate: "2026-06-15", endDate: "2026-09-15", adjustmentType: "percent", adjustment: 18, minStay: 2, promoCode: null, segment: "All guests", active: true },
    { id: "rr_winter", name: "Winter escape", startDate: "2026-11-01", endDate: "2027-02-28", adjustmentType: "percent", adjustment: -12, minStay: 2, promoCode: "WINTER12", segment: "Leisure", active: true },
    { id: "rr_corporate", name: "Corporate preferred", startDate: "2026-01-01", endDate: "2026-12-31", adjustmentType: "percent", adjustment: -15, minStay: 1, promoCode: "CORP15", segment: "Corporate", active: true },
    { id: "rr_concert", name: "Festival weekend", startDate: "2026-08-21", endDate: "2026-08-24", adjustmentType: "fixed", adjustment: 45, minStay: 2, promoCode: null, segment: "All guests", active: true },
    { id: "rr_cityguide", name: "City Guide affiliate", startDate: "2026-01-01", endDate: "2027-12-31", adjustmentType: "percent", adjustment: -8, minStay: 1, promoCode: "CITYGUIDE", segment: "Affiliate", active: true }
  ];
  const insertRateRule = db.prepare("INSERT OR IGNORE INTO rate_rule VALUES (?, 'prop_aurora', ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const item of rateRules) insertRateRule.run(item.id, item.name, item.startDate, item.endDate, item.adjustmentType, item.adjustment, item.minStay, item.promoCode, item.segment, Number(item.active));

  const affiliates: Affiliate[] = [
    { id: "aff_city", code: "CITYGUIDE", name: "City Guide Collective", commissionPercent: 8, bookings: 42, revenue: 18460, status: "active" },
    { id: "aff_corp", code: "NORTHSTAR", name: "Northstar Corporate Travel", commissionPercent: 10, bookings: 67, revenue: 35920, status: "active" },
    { id: "aff_wellness", code: "WELLNESS5", name: "Wellness Circle", commissionPercent: 5, bookings: 18, revenue: 6840, status: "active" }
  ];
  const insertAffiliate = db.prepare("INSERT OR IGNORE INTO affiliate VALUES (?, 'prop_aurora', ?, ?, ?, ?, ?, ?)");
  for (const item of affiliates) insertAffiliate.run(item.id, item.code, item.name, item.commissionPercent, item.bookings, item.revenue, item.status);

  const services: ServiceOffering[] = [
    ["svc_breakfast", "BREAKFAST", "Aurora breakfast", "dining", "Sol Restaurant", 90, 90, 24, 0, "standard", false, ["07:00", "08:30", "10:00"]],
    ["svc_tea", "AFTERNOON-TEA", "Afternoon tea", "dining", "Atrium Lounge", 90, 36, 38, 0, "standard", false, ["14:30", "16:00"]],
    ["svc_dinner", "CHEF-DINNER", "Chef's table dinner", "dining", "Sol Restaurant", 150, 12, 145, 12, "standard", false, ["19:00", "20:00"]],
    ["svc_photo", "PHOTO", "Hotel photography session", "guest_service", "Property grounds", 60, 6, 95, 0, "standard", false, ["09:00", "11:00", "16:00"]],
    ["svc_pool", "POOL", "Pool & cabana access", "wellness", "Sky Pool", 240, 24, 45, 0, "controlled", false, ["09:00", "14:00"]],
    ["svc_laundry", "LAUNDRY", "Express laundry bundle", "guest_service", "Laundry", 480, 30, 32, 0, "standard", false, ["08:00", "12:00"]],
    ["svc_massage", "MASSAGE", "Signature massage", "wellness", "Aurora Spa", 60, 8, 110, 16, "standard", false, ["10:00", "12:00", "14:00", "16:00", "18:00"]],
    ["svc_club", "CLUB", "Members club evening", "entertainment", "Nocturne Club", 240, 80, 55, 18, "controlled", false, ["21:00"]],
    ["svc_concert", "CONCERT", "Live concert admission", "entertainment", "Grand Hall", 150, 220, 75, 8, "standard", false, ["20:00"]],
    ["svc_show", "SHOW", "Theatre & dance show", "entertainment", "Aurora Theatre", 120, 160, 65, 5, "standard", false, ["18:30", "21:00"]],
    ["svc_cinema", "CINEMA", "Private cinema screening", "entertainment", "Screening Room", 120, 32, 28, 5, "standard", false, ["17:00", "20:00"]],
    ["svc_sailing", "SAILING", "Coastal sailing lesson", "marine", "Marina", 150, 10, 135, 12, "controlled", true, ["08:00", "13:00"]],
    ["svc_cruise", "CRUISE", "Sunset dinner cruise", "marine", "Marina", 180, 60, 175, 6, "controlled", true, ["17:30"]],
    ["svc_bungee", "BUNGEE", "Canyon bungee jump", "adventure", "Adventure Base", 90, 8, 190, 18, "high", true, ["09:00", "11:00", "14:00"]],
    ["svc_para", "PARAGLIDE", "Tandem paragliding", "adventure", "Mountain Launch", 120, 6, 225, 16, "high", true, ["08:00", "10:30", "14:30"]]
  ].map((row) => ({ id: row[0], code: row[1], name: row[2], category: row[3], venue: row[4], durationMinutes: row[5], capacityPerSlot: row[6], price: row[7], minAge: row[8], riskLevel: row[9], requiresWaiver: row[10], slots: row[11], active: true } as ServiceOffering));
  const insertService = db.prepare("INSERT OR IGNORE INTO service_offering VALUES (?, 'prop_aurora', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const item of services) insertService.run(item.id, item.code, item.name, item.category, item.venue, item.durationMinutes, item.capacityPerSlot, item.price, item.minAge, item.riskLevel, Number(item.requiresWaiver), JSON.stringify(item.slots), Number(item.active));

  const tasks: HousekeepingTask[] = [
    { id: "hk_203", roomId: "room_203", type: "checkout_clean", priority: "urgent", assignee: "Nadia K.", status: "in_progress", dueAt: `${isoDate(new Date())}T11:30:00`, notes: "Accessible-room checklist" },
    { id: "hk_201", roomId: "room_201", type: "inspection", priority: "high", assignee: "Samira Noor", status: "inspection", dueAt: `${isoDate(new Date())}T12:00:00`, notes: "Arrival priority" },
    { id: "hk_301", roomId: "room_301", type: "stayover", priority: "normal", assignee: "Maya R.", status: "queued", dueAt: `${isoDate(new Date())}T14:00:00`, notes: "Guest requested linen reuse" },
    { id: "hk_linen", roomId: "room_204", type: "linen", priority: "normal", assignee: "Laundry team", status: "queued", dueAt: `${isoDate(new Date())}T15:00:00`, notes: "Family linen par replenishment" }
  ];
  const insertTask = db.prepare("INSERT OR IGNORE INTO housekeeping_task VALUES (?, 'prop_aurora', ?, ?, ?, ?, ?, ?, ?)");
  for (const item of tasks) insertTask.run(item.id, item.roomId, item.type, item.priority, item.assignee, item.status, item.dueAt, item.notes);

  const inventory: InventoryItem[] = [
    ["inv_linen", "LIN-KING-01", "King sheet set", "linen", "Main Linen", "set", 84, 96, 72, 18.5, "weighted_average", false],
    ["inv_towels", "LIN-TOWEL-01", "Bath towel", "linen", "Main Linen", "piece", 146, 180, 135, 7.2, "weighted_average", false],
    ["inv_shampoo", "AMN-SHAMP-01", "Refillable shampoo", "amenity", "Housekeeping Store", "liter", 31, 40, 20, 8.9, "FIFO", true],
    ["inv_cleaner", "CLN-ECO-01", "Eco surface cleaner", "cleaning", "Chemical Store", "liter", 14, 30, 18, 11.4, "FIFO", true],
    ["inv_coffee", "FNB-COFFEE-01", "Arabica coffee beans", "food", "Kitchen Dry Store", "kg", 22, 35, 16, 24, "FIFO", true],
    ["inv_wine", "FNB-WINE-01", "House red wine", "beverage", "Beverage Cellar", "bottle", 58, 72, 36, 13.5, "FIFO", false],
    ["inv_filter", "ENG-HVAC-01", "HVAC filter", "engineering", "Engineering Store", "piece", 9, 16, 8, 26, "weighted_average", false]
  ].map((row) => ({ id: row[0], sku: row[1], name: row[2], category: row[3], warehouse: row[4], unit: row[5], onHand: row[6], parLevel: row[7], reorderPoint: row[8], unitCost: row[9], valuation: row[10], expiryTracked: row[11] } as InventoryItem));
  const insertInventory = db.prepare("INSERT OR IGNORE INTO inventory_item VALUES (?, 'prop_aurora', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const item of inventory) insertInventory.run(item.id, item.sku, item.name, item.category, item.warehouse, item.unit, item.onHand, item.parLevel, item.reorderPoint, item.unitCost, item.valuation, Number(item.expiryTracked));

  const journals: JournalEntry[] = [
    { id: "je_room", journalNumber: "JE-260731-001", businessDate: isoDate(new Date()), source: "Guest ledger", description: "Room revenue and guest receivable", status: "posted", lines: [{ accountCode: "1100", accountName: "Guest ledger receivable", costCenter: "Rooms", debit: 610.5, credit: 0 }, { accountCode: "4010", accountName: "Room revenue", costCenter: "Rooms", debit: 0, credit: 555 }, { accountCode: "2210", accountName: "Occupancy tax payable", costCenter: "Tax", debit: 0, credit: 55.5 }] },
    { id: "je_inventory", journalNumber: "JE-260731-002", businessDate: isoDate(new Date()), source: "Inventory", description: "Housekeeping supplies issued", status: "posted", lines: [{ accountCode: "5110", accountName: "Guest supplies expense", costCenter: "Housekeeping", debit: 89, credit: 0 }, { accountCode: "1300", accountName: "Operating inventory", costCenter: "Stores", debit: 0, credit: 89 }] }
  ];
  const insertJournal = db.prepare("INSERT OR IGNORE INTO journal_entry VALUES (?, 'prop_aurora', ?, ?, ?, ?, ?, ?)");
  for (const item of journals) insertJournal.run(item.id, item.journalNumber, item.businessDate, item.source, item.description, item.status, JSON.stringify(item.lines));

  const profiles: GuestProfile[] = [
    { id: "guest_amina", name: "Amina Rahimi", email: "amina@example.com", phone: "+98 912 555 0184", loyaltyTier: "Gold", stays: 7, lifetimeValue: 6840, consent: { email: true, sms: false, personalization: true }, preferences: ["High floor", "Firm pillow", "Late checkout"], dietaryNeeds: ["Vegetarian"], tags: ["VIP", "Direct booker"] },
    { id: "guest_sofia", name: "Sofia Martinez", email: "sofia@example.com", phone: "+34 610 443 102", loyaltyTier: "Silver", stays: 3, lifetimeValue: 2150, consent: { email: true, sms: true, personalization: true }, preferences: ["Quiet room", "Spa appointments"], dietaryNeeds: ["Gluten-free"], tags: ["Wellness"] },
    { id: "guest_liam", name: "Liam Chen", email: "liam@example.com", phone: "+65 8123 4410", loyaltyTier: "Member", stays: 2, lifetimeValue: 980, consent: { email: false, sms: true, personalization: false }, preferences: ["Twin room", "Express checkout"], dietaryNeeds: [], tags: ["Business"] }
  ];
  const insertProfile = db.prepare("INSERT OR IGNORE INTO guest_profile VALUES (?, 'prop_aurora', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const item of profiles) insertProfile.run(item.id, item.name, item.email, item.phone, item.loyaltyTier, item.stays, item.lifetimeValue, JSON.stringify(item.consent), JSON.stringify(item.preferences), JSON.stringify(item.dietaryNeeds), JSON.stringify(item.tags));
}

initializeExtendedDatabase();

const createReservationSchema = z.object({
  guestName: z.string().trim().min(2).max(120),
  email: z.string().email(),
  arrival: z.string().date(),
  departure: z.string().date(),
  adults: z.number().int().min(1).max(12),
  infants: z.number().int().min(0).max(6).default(0),
  children: z.number().int().min(0).max(8).default(0),
  teens: z.number().int().min(0).max(8).default(0),
  seniors: z.number().int().min(0).max(8).default(0),
  roomProductId: z.string().min(3),
  ratePlanId: z.string().min(3),
  mealPlanId: z.string().min(3),
  promoCode: z.string().trim().max(30).optional(),
  source: z.enum(["Direct", "OTA", "Corporate", "Walk-in"]),
  idempotencyKey: z.string().min(8).max(100)
});

const commandSchema = z.object({
  reason: z.string().min(3).max(240),
  roomId: z.string().optional(),
  amount: z.number().positive().max(1_000_000).optional(),
  description: z.string().min(2).max(160).optional(),
  code: z.string().min(2).max(20).optional(),
  tokenLast4: z.string().regex(/^\d{4}$/).optional(),
  idempotencyKey: z.string().min(8).max(100).optional()
});

const parseJson = <T>(value: unknown): T => JSON.parse(String(value)) as T;

function rowsToDashboard(propertyId = "prop_aurora"): Dashboard {
  const property = db.prepare("SELECT * FROM property WHERE id = ?").get(propertyId) as Record<string, string> | undefined;
  if (!property) throw new ApiError(404, "PROPERTY_NOT_FOUND", "Property scope not found");
  const rooms = (db.prepare("SELECT * FROM room WHERE property_id = ? ORDER BY number").all(propertyId) as Array<Record<string, unknown>>).map(
    (row) => ({
      id: String(row.id),
      number: String(row.number),
      floor: Number(row.floor),
      type: row.type as Room["type"],
      status: row.status as Room["status"],
      rate: Number(row.rate),
      features: JSON.parse(String(row.features_json)) as string[]
    })
  );
  const reservations = (db.prepare(`
    SELECT r.*, COALESCE(
      SUM(CASE WHEN f.kind = 'charge' THEN f.amount ELSE -f.amount END), 0
    ) AS balance
    FROM reservation r
    LEFT JOIN folio_entry f ON f.reservation_id = r.id
    WHERE r.property_id = ?
    GROUP BY r.id
    ORDER BY CASE r.status WHEN 'checked_in' THEN 0 WHEN 'confirmed' THEN 1 ELSE 2 END, r.arrival
  `).all(propertyId) as Array<Record<string, unknown>>).map(mapReservation);
  const folios = (db.prepare(`
    SELECT f.* FROM folio_entry f JOIN reservation r ON r.id = f.reservation_id
    WHERE r.property_id = ? ORDER BY f.created_at DESC
  `).all(propertyId) as Array<Record<string, unknown>>).map(
    (row) => ({
      id: String(row.id),
      reservationId: String(row.reservation_id),
      kind: row.kind as "charge" | "payment",
      code: String(row.code),
      description: String(row.description),
      amount: Number(row.amount),
      createdAt: String(row.created_at)
    })
  );
  const audit = (db.prepare("SELECT * FROM audit_event WHERE property_id = ? ORDER BY at DESC LIMIT 50").all(propertyId) as Array<Record<string, unknown>>).map(
    (row) => ({
      id: String(row.id),
      action: String(row.action),
      entityType: String(row.entity_type),
      entityId: String(row.entity_id),
      actor: String(row.actor),
      reason: String(row.reason),
      at: String(row.at),
      correlationId: String(row.correlation_id),
      summary: String(row.summary)
    })
  );
  const roomProducts = (db.prepare("SELECT * FROM room_product WHERE property_id=? ORDER BY base_rate").all(propertyId) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id), code: String(row.code), name: String(row.name), category: row.category as RoomProduct["category"], roomType: row.room_type as Room["type"], description: String(row.description), maxOccupancy: parseJson<RoomProduct["maxOccupancy"]>(row.max_occupancy_json), beds: parseJson<RoomProduct["beds"]>(row.beds_json), amenities: parseJson<string[]>(row.amenities_json), accessible: Boolean(row.accessible), baseRate: Number(row.base_rate)
  }));
  const mealPlans = (db.prepare("SELECT * FROM meal_plan WHERE property_id=? ORDER BY adult_price").all(propertyId) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id), code: row.code as MealPlan["code"], name: String(row.name), periods: parseJson<MealPlan["periods"]>(row.periods_json), adultPrice: Number(row.adult_price), childPrice: Number(row.child_price)
  }));
  const ratePlans = (db.prepare("SELECT * FROM rate_plan WHERE property_id=? ORDER BY discount_percent").all(propertyId) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id), code: String(row.code), name: String(row.name), mealPlanId: String(row.meal_plan_id), refundable: Boolean(row.refundable), advancePurchaseDays: Number(row.advance_purchase_days), discountPercent: Number(row.discount_percent), eligibleRoomProductIds: parseJson<string[]>(row.eligible_room_products_json)
  }));
  const rateRules = (db.prepare("SELECT * FROM rate_rule WHERE property_id=? ORDER BY start_date").all(propertyId) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id), name: String(row.name), startDate: String(row.start_date), endDate: String(row.end_date), adjustmentType: row.adjustment_type as RateRule["adjustmentType"], adjustment: Number(row.adjustment), minStay: Number(row.min_stay), promoCode: row.promo_code ? String(row.promo_code) : null, segment: String(row.segment), active: Boolean(row.active)
  }));
  const affiliates = (db.prepare("SELECT * FROM affiliate WHERE property_id=? ORDER BY revenue DESC").all(propertyId) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id), code: String(row.code), name: String(row.name), commissionPercent: Number(row.commission_percent), bookings: Number(row.bookings), revenue: Number(row.revenue), status: row.status as Affiliate["status"]
  }));
  const services = (db.prepare("SELECT * FROM service_offering WHERE property_id=? AND active=1 ORDER BY category,name").all(propertyId) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id), code: String(row.code), name: String(row.name), category: row.category as ServiceOffering["category"], venue: String(row.venue), durationMinutes: Number(row.duration_minutes), capacityPerSlot: Number(row.capacity_per_slot), price: Number(row.price), minAge: Number(row.min_age), riskLevel: row.risk_level as ServiceOffering["riskLevel"], requiresWaiver: Boolean(row.requires_waiver), slots: parseJson<string[]>(row.slots_json), active: Boolean(row.active)
  }));
  const serviceBookings = (db.prepare("SELECT * FROM service_booking WHERE property_id=? ORDER BY service_date,slot").all(propertyId) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id), serviceId: String(row.service_id), reservationId: row.reservation_id ? String(row.reservation_id) : null, guestName: String(row.guest_name), serviceDate: String(row.service_date), slot: String(row.slot), participants: Number(row.participants), status: row.status as ServiceBooking["status"], total: Number(row.total), createdAt: String(row.created_at)
  }));
  const housekeepingTasks = (db.prepare("SELECT * FROM housekeeping_task WHERE property_id=? ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,due_at").all(propertyId) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id), roomId: String(row.room_id), type: row.type as HousekeepingTask["type"], priority: row.priority as HousekeepingTask["priority"], assignee: String(row.assignee), status: row.status as HousekeepingTask["status"], dueAt: String(row.due_at), notes: String(row.notes)
  }));
  const inventoryItems = (db.prepare("SELECT * FROM inventory_item WHERE property_id=? ORDER BY category,name").all(propertyId) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id), sku: String(row.sku), name: String(row.name), category: row.category as InventoryItem["category"], warehouse: String(row.warehouse), unit: String(row.unit), onHand: Number(row.on_hand), parLevel: Number(row.par_level), reorderPoint: Number(row.reorder_point), unitCost: Number(row.unit_cost), valuation: row.valuation as InventoryItem["valuation"], expiryTracked: Boolean(row.expiry_tracked)
  }));
  const stockMovements = (db.prepare("SELECT * FROM stock_movement WHERE property_id=? ORDER BY created_at DESC LIMIT 100").all(propertyId) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id), itemId: String(row.item_id), type: row.type as StockMovement["type"], quantity: Number(row.quantity), unitCost: Number(row.unit_cost), department: String(row.department), reference: String(row.reference), createdAt: String(row.created_at)
  }));
  const journalEntries = (db.prepare("SELECT * FROM journal_entry WHERE property_id=? ORDER BY business_date DESC,journal_number DESC").all(propertyId) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id), journalNumber: String(row.journal_number), businessDate: String(row.business_date), source: String(row.source), description: String(row.description), status: row.status as JournalEntry["status"], lines: parseJson<JournalEntry["lines"]>(row.lines_json)
  }));
  const guestProfiles = (db.prepare("SELECT * FROM guest_profile WHERE property_id=? ORDER BY lifetime_value DESC").all(propertyId) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id), name: String(row.name), email: String(row.email), phone: String(row.phone), loyaltyTier: row.loyalty_tier as GuestProfile["loyaltyTier"], stays: Number(row.stays), lifetimeValue: Number(row.lifetime_value), consent: parseJson<GuestProfile["consent"]>(row.consent_json), preferences: parseJson<string[]>(row.preferences_json), dietaryNeeds: parseJson<string[]>(row.dietary_json), tags: parseJson<string[]>(row.tags_json)
  }));
  const active = reservations.filter((r) => r.status === "checked_in").length;
  const sellable = rooms.filter((r) => r.status !== "out_of_order").length;
  return {
    businessDate: property.business_date,
    property: {
      id: property.id,
      name: property.name,
      code: property.code,
      timezone: property.timezone,
      currency: property.currency
    },
    metrics: {
      occupancy: sellable ? Math.round((active / sellable) * 100) : 0,
      arrivals: reservations.filter((r) => r.arrival === property.business_date && r.status === "confirmed").length,
      departures: reservations.filter((r) => r.departure === property.business_date && r.status === "checked_in").length,
      inHouse: active,
      available: rooms.filter((r) => r.status === "vacant_clean").length,
      roomRevenue: folios.filter((f) => f.kind === "charge" && f.code === "ROOM").reduce((sum, f) => sum + f.amount, 0)
    },
    rooms,
    reservations,
    folios,
    audit,
    roomProducts,
    mealPlans,
    ratePlans,
    rateRules,
    affiliates,
    services,
    serviceBookings,
    housekeepingTasks,
    inventoryItems,
    stockMovements,
    journalEntries,
    guestProfiles
  };
}

function mapReservation(row: Record<string, unknown>): Reservation {
  return {
    id: String(row.id),
    confirmation: String(row.confirmation),
    guestName: String(row.guest_name),
    email: String(row.email),
    arrival: String(row.arrival),
    departure: String(row.departure),
    adults: Number(row.adults),
    infants: Number(row.infants ?? 0),
    children: Number(row.children ?? 0),
    teens: Number(row.teens ?? 0),
    seniors: Number(row.seniors ?? 0),
    roomType: row.room_type as Room["type"],
    roomProductId: row.room_product_id ? String(row.room_product_id) : null,
    ratePlanId: row.rate_plan_id ? String(row.rate_plan_id) : null,
    mealPlanId: row.meal_plan_id ? String(row.meal_plan_id) : null,
    roomId: row.room_id ? String(row.room_id) : null,
    status: row.status as Reservation["status"],
    source: row.source as Reservation["source"],
    balance: Number(row.balance ?? 0),
    total: Number(row.total),
    createdAt: String(row.created_at),
    version: Number(row.version),
    priceExplanation: parseJson<string[]>(row.price_explanation_json ?? "[]")
  };
}

function transaction<T>(work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function recordChange(action: string, entityType: string, entityId: string, actor: string, reason: string, summary: string, correlationId: string, propertyId = "prop_aurora") {
  const now = new Date().toISOString();
  db.prepare("INSERT INTO audit_event VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    randomUUID(), propertyId, action, entityType, entityId, actor, reason, now, correlationId, summary
  );
  db.prepare("INSERT INTO outbox VALUES (?, ?, ?, ?, ?, NULL)").run(
    randomUUID(), `hospitality.${entityType}.${action}.v1`, entityId,
    JSON.stringify({ entityId, action, correlationId, occurredAt: now }), now
  );
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 100_000) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Request body exceeds 100 KB");
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

type RequestSession = AuthSession & { sessionId: string };
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const dummyPasswordHash = hashPassword("not-the-demo-password");

function parseCookies(request: IncomingMessage): Record<string, string> {
  return Object.fromEntries(
    (request.headers.cookie ?? "")
      .split(";")
      .map((item) => item.trim().split("="))
      .filter(([key, value]) => Boolean(key && value))
      .map(([key, value]) => [key, decodeURIComponent(value)])
  );
}

function mapAuthUser(row: Record<string, unknown>): AuthUser {
  const role = row.role as Role;
  const name = String(row.name);
  return {
    id: String(row.id),
    name,
    email: String(row.email),
    role,
    roleLabel: roleLabels[role],
    propertyId: String(row.property_id),
    permissions: [...rolePermissions[role]],
    initials: name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase()
  };
}

function requireSession(request: IncomingMessage): RequestSession {
  const sessionToken = parseCookies(request).aurelia_session;
  if (!sessionToken) throw new ApiError(401, "AUTHENTICATION_REQUIRED", "Sign in to continue");
  const sessionId = sessionKey(sessionToken);
  const row = db.prepare(`
    SELECT u.*, s.csrf_token, s.expires_at
    FROM user_session s JOIN user_account u ON u.id = s.user_id
    WHERE s.id = ? AND s.expires_at > ? AND u.active = 1
  `).get(sessionId, new Date().toISOString()) as Record<string, unknown> | undefined;
  if (!row) throw new ApiError(401, "SESSION_EXPIRED", "Your session has expired. Sign in again.");
  return { sessionId, user: mapAuthUser(row), csrfToken: String(row.csrf_token) };
}

function requirePermission(session: RequestSession, permission: Permission) {
  if (!session.user.permissions.includes(permission)) {
    throw new ApiError(403, "PERMISSION_DENIED", `Your role does not allow ${permission}`);
  }
}

function requireCsrf(request: IncomingMessage, session: RequestSession) {
  if (request.headers["x-csrf-token"] !== session.csrfToken) {
    throw new ApiError(403, "CSRF_VALIDATION_FAILED", "The security token is missing or invalid");
  }
}

function actor(session: RequestSession): string {
  return `${session.user.name} · ${session.user.roleLabel}`;
}

function scopeDashboard(dashboard: Dashboard, session: RequestSession): Dashboard {
  const canReadReservations = session.user.permissions.includes("reservation.read");
  const canReadFolios = session.user.permissions.includes("folio.read");
  const canReadAudit = session.user.permissions.includes("audit.read");
  const canReadCatalog = session.user.permissions.includes("catalog.read");
  const canReadRates = session.user.permissions.includes("rate.read");
  const canReadServices = session.user.permissions.includes("service.read");
  const canReadHousekeeping = session.user.permissions.includes("housekeeping.read");
  const canReadInventory = session.user.permissions.includes("inventory.read");
  const canReadAccounting = session.user.permissions.includes("accounting.read");
  const canReadCrm = session.user.permissions.includes("crm.read");
  const canReadAffiliates = session.user.permissions.includes("affiliate.read");
  return {
    ...dashboard,
    metrics: { ...dashboard.metrics, roomRevenue: canReadFolios ? dashboard.metrics.roomRevenue : 0 },
    reservations: canReadReservations
      ? dashboard.reservations.map((reservation) => canReadFolios ? reservation : { ...reservation, balance: 0 })
      : [],
    folios: canReadFolios ? dashboard.folios : [],
    audit: canReadAudit ? dashboard.audit : [],
    roomProducts: canReadCatalog ? dashboard.roomProducts : [],
    mealPlans: canReadCatalog || canReadRates ? dashboard.mealPlans : [],
    ratePlans: canReadRates ? dashboard.ratePlans : [],
    rateRules: canReadRates ? dashboard.rateRules : [],
    affiliates: canReadAffiliates ? dashboard.affiliates : [],
    services: canReadServices ? dashboard.services : [],
    serviceBookings: canReadServices ? dashboard.serviceBookings : [],
    housekeepingTasks: canReadHousekeeping ? dashboard.housekeepingTasks : [],
    inventoryItems: canReadInventory ? dashboard.inventoryItems : [],
    stockMovements: canReadInventory ? dashboard.stockMovements : [],
    journalEntries: canReadAccounting ? dashboard.journalEntries : [],
    guestProfiles: canReadCrm ? dashboard.guestProfiles : []
  };
}

function json(response: ServerResponse, status: number, value: unknown, correlationId: string) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-correlation-id": correlationId,
    "x-content-type-options": "nosniff"
  });
  response.end(JSON.stringify(value));
}

function findReservation(id: string, propertyId = "prop_aurora") {
  const row = db.prepare(`
    SELECT r.*, COALESCE(SUM(CASE WHEN f.kind='charge' THEN f.amount ELSE -f.amount END), 0) AS balance
    FROM reservation r LEFT JOIN folio_entry f ON f.reservation_id = r.id
    WHERE r.id = ? AND r.property_id = ? GROUP BY r.id
  `).get(id, propertyId) as Record<string, unknown> | undefined;
  if (!row) throw new ApiError(404, "RESERVATION_NOT_FOUND", "Reservation not found");
  return mapReservation(row);
}

async function handleApi(request: IncomingMessage, response: ServerResponse, url: URL, correlationId: string) {
  if (request.method === "POST" && url.pathname === "/api/auth/login") {
    const clientKey = request.socket.remoteAddress ?? "local";
    const attempt = loginAttempts.get(clientKey);
    if (attempt && attempt.resetAt > Date.now() && attempt.count >= 5) {
      throw new ApiError(429, "LOGIN_RATE_LIMITED", "Too many sign-in attempts. Try again later.");
    }
    const credentials = z.object({
      email: z.string().trim().toLowerCase().email(),
      password: z.string().min(8).max(200)
    }).parse(await readJson(request));
    const row = db.prepare("SELECT * FROM user_account WHERE email = ? AND active = 1").get(credentials.email) as Record<string, unknown> | undefined;
    const valid = verifyPassword(credentials.password, row ? String(row.password_hash) : dummyPasswordHash);
    if (!row || !valid) {
      const current = attempt && attempt.resetAt > Date.now() ? attempt.count : 0;
      loginAttempts.set(clientKey, { count: current + 1, resetAt: Date.now() + 10 * 60_000 });
      throw new ApiError(401, "INVALID_CREDENTIALS", "Email or password is incorrect");
    }
    loginAttempts.delete(clientKey);
    db.prepare("DELETE FROM user_session WHERE expires_at <= ?").run(new Date().toISOString());
    const sessionToken = randomBytes(32).toString("base64url");
    const sessionId = sessionKey(sessionToken);
    const csrfToken = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + 8 * 60 * 60_000).toISOString();
    db.prepare("INSERT INTO user_session VALUES (?, ?, ?, ?, ?)").run(sessionId, String(row.id), csrfToken, expiresAt, new Date().toISOString());
    response.setHeader("set-cookie", `aurelia_session=${sessionToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
    const user = mapAuthUser(row);
    recordChange("signed_in", "security", user.id, `${user.name} · ${user.roleLabel}`, "Interactive password sign-in", `${user.name} signed in`, correlationId, user.propertyId);
    return json(response, 200, { user, csrfToken }, correlationId);
  }

  const session = requireSession(request);
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method ?? "GET")) requireCsrf(request, session);

  if (request.method === "GET" && url.pathname === "/api/auth/me") {
    return json(response, 200, { user: session.user, csrfToken: session.csrfToken }, correlationId);
  }

  if (request.method === "POST" && url.pathname === "/api/auth/logout") {
    db.prepare("DELETE FROM user_session WHERE id = ?").run(session.sessionId);
    response.setHeader("set-cookie", "aurelia_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
    recordChange("signed_out", "security", session.user.id, actor(session), "User requested sign-out", `${session.user.name} signed out`, correlationId, session.user.propertyId);
    return json(response, 200, { signedOut: true }, correlationId);
  }

  if (request.method === "GET" && url.pathname === "/api/dashboard") {
    requirePermission(session, "dashboard.read");
    return json(response, 200, scopeDashboard(rowsToDashboard(session.user.propertyId), session), correlationId);
  }

  if (request.method === "GET" && url.pathname === "/api/availability") {
    requirePermission(session, "reservation.read");
    const query = z.object({
      arrival: z.string().date(),
      departure: z.string().date(),
      roomType: z.enum(["King", "Twin", "Suite"])
    }).parse(Object.fromEntries(url.searchParams));
    if (query.arrival >= query.departure) throw new ApiError(422, "INVALID_STAY_DATES", "Departure must be after arrival");
    const rooms = db.prepare(`
      SELECT room.* FROM room
      WHERE room.property_id = ? AND room.type = ? AND room.status != 'out_of_order'
      AND NOT EXISTS (
        SELECT 1 FROM reservation r
        WHERE r.room_id = room.id
        AND r.status NOT IN ('cancelled', 'checked_out', 'no_show')
        AND r.arrival < ? AND ? < r.departure
      ) ORDER BY room.rate, room.number
    `).all(session.user.propertyId, query.roomType, query.departure, query.arrival);
    return json(response, 200, { available: rooms.length, rooms }, correlationId);
  }

  if (request.method === "POST" && url.pathname === "/api/reservations") {
    requirePermission(session, "reservation.create");
    const input = createReservationSchema.parse(await readJson(request));
    const result = transaction(() => {
      const existing = db.prepare("SELECT id FROM reservation WHERE idempotency_key = ? AND property_id = ?").get(input.idempotencyKey, session.user.propertyId) as { id: string } | undefined;
      if (existing) return findReservation(existing.id, session.user.propertyId);
      if (input.arrival >= input.departure) throw new ApiError(422, "INVALID_STAY_DATES", "Departure must be after arrival");
      const product = db.prepare("SELECT * FROM room_product WHERE id=? AND property_id=?").get(input.roomProductId, session.user.propertyId) as Record<string, unknown> | undefined;
      const ratePlan = db.prepare("SELECT * FROM rate_plan WHERE id=? AND property_id=?").get(input.ratePlanId, session.user.propertyId) as Record<string, unknown> | undefined;
      const mealPlan = db.prepare("SELECT * FROM meal_plan WHERE id=? AND property_id=?").get(input.mealPlanId, session.user.propertyId) as Record<string, unknown> | undefined;
      if (!product || !ratePlan || !mealPlan) throw new ApiError(422, "INVALID_PRODUCT_SELECTION", "Room product, rate plan, or meal plan is invalid");
      if (!parseJson<string[]>(ratePlan.eligible_room_products_json).includes(input.roomProductId)) throw new ApiError(422, "RATE_NOT_ELIGIBLE", "The selected rate does not apply to this room product");
      const property = db.prepare("SELECT business_date FROM property WHERE id=?").get(session.user.propertyId) as { business_date: string };
      if (!meetsAdvancePurchase(input.arrival, property.business_date, Number(ratePlan.advance_purchase_days))) {
        throw new ApiError(422, "ADVANCE_PURCHASE_REQUIRED", `${ratePlan.name} must be booked at least ${ratePlan.advance_purchase_days} day(s) before arrival`);
      }
      const capacity = parseJson<RoomProduct["maxOccupancy"]>(product.max_occupancy_json);
      const requested = { infant: input.infants, child: input.children, teen: input.teens, adult: input.adults, senior: input.seniors };
      const occupancyErrors = validateAgeCapacity(capacity, requested);
      if (occupancyErrors.length) throw new ApiError(422, "OCCUPANCY_EXCEEDED", `${product.name} does not support the requested age composition: ${occupancyErrors.join(", ")}`);
      const room = db.prepare(`
        SELECT room.* FROM room WHERE property_id = ? AND type = ? AND status != 'out_of_order'
        AND NOT EXISTS (
          SELECT 1 FROM reservation r WHERE r.room_id = room.id
          AND r.status NOT IN ('cancelled','checked_out','no_show')
          AND r.arrival < ? AND ? < r.departure
        ) ORDER BY rate, number LIMIT 1
      `).get(session.user.propertyId, String(product.room_type), input.departure, input.arrival) as Record<string, unknown> | undefined;
      if (!room) throw new ApiError(409, "INVENTORY_UNAVAILABLE", "No inventory remains for those stay dates");
      const id = randomUUID();
      const confirmation = `AUR-${String(Date.now()).slice(-6)}`;
      const rules = (db.prepare("SELECT * FROM rate_rule WHERE property_id=? AND active=1").all(session.user.propertyId) as Array<Record<string, unknown>>).map((rule) => ({
        id: String(rule.id), name: String(rule.name), startDate: String(rule.start_date), endDate: String(rule.end_date), adjustmentType: rule.adjustment_type as RateRule["adjustmentType"], adjustment: Number(rule.adjustment), minStay: Number(rule.min_stay), promoCode: rule.promo_code ? String(rule.promo_code) : null, segment: String(rule.segment), active: Boolean(rule.active)
      }));
      const price = calculateReservationPrice({ arrival: input.arrival, departure: input.departure, baseRate: Number(product.base_rate), productCode: String(product.code), ratePlanName: String(ratePlan.name), rateDiscountPercent: Number(ratePlan.discount_percent), mealPlanCode: String(mealPlan.code), mealPlanName: String(mealPlan.name), mealPeriods: parseJson<string[]>(mealPlan.periods_json), adultMealPrice: Number(mealPlan.adult_price), childMealPrice: Number(mealPlan.child_price), adultMealGuests: input.adults + input.teens + input.seniors, childMealGuests: input.children, promoCode: input.promoCode, source: input.source, rules, taxRate: 0.1 });
      const { total, explanation } = price;
      const affiliate = input.promoCode
        ? db.prepare("SELECT * FROM affiliate WHERE property_id=? AND UPPER(code)=UPPER(?) AND status='active'").get(session.user.propertyId, input.promoCode) as Record<string, unknown> | undefined
        : undefined;
      if (affiliate) explanation.push(`Affiliate: ${affiliate.name} · ${Number(affiliate.commission_percent).toFixed(1)}% commission`);
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO reservation
        (id, property_id, confirmation, guest_name, email, arrival, departure, adults, room_type, room_id, status, source, total, created_at, idempotency_key, room_product_id, rate_plan_id, meal_plan_id, infants, children, teens, seniors, price_explanation_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, session.user.propertyId, confirmation, input.guestName, input.email, input.arrival, input.departure, input.adults, String(product.room_type), String(room.id), input.source, total, now, input.idempotencyKey, input.roomProductId, input.ratePlanId, input.mealPlanId, input.infants, input.children, input.teens, input.seniors, JSON.stringify(explanation));
      if (affiliate) db.prepare("UPDATE affiliate SET bookings=bookings+1, revenue=revenue+? WHERE id=?").run(total, String(affiliate.id));
      recordChange("created", "reservation", id, actor(session), "Guest booking request", `${confirmation} confirmed for ${input.guestName}`, correlationId, session.user.propertyId);
      return findReservation(id, session.user.propertyId);
    });
    return json(response, 201, result, correlationId);
  }

  const reservationCommand = url.pathname.match(/^\/api\/reservations\/([^/]+)\/(check-in|postings|payment|checkout)$/);
  if (request.method === "POST" && reservationCommand) {
    const [, reservationId, action] = reservationCommand;
    const command = commandSchema.parse(await readJson(request));
    const requiredPermission: Record<string, Permission> = {
      "check-in": "reservation.checkin",
      postings: "folio.post",
      payment: "payment.capture",
      checkout: "stay.checkout"
    };
    requirePermission(session, requiredPermission[action]);
    const result = transaction(() => {
      const reservation = findReservation(reservationId, session.user.propertyId);
      if (action === "check-in") {
        if (reservation.status !== "confirmed") throw new ApiError(409, "INVALID_RESERVATION_STATE", "Only confirmed reservations can be checked in");
        if (!command.roomId) throw new ApiError(422, "ROOM_REQUIRED", "Select a room");
        const room = db.prepare("SELECT * FROM room WHERE id = ? AND property_id = ?").get(command.roomId, session.user.propertyId) as Record<string, unknown> | undefined;
        if (!room || room.status !== "vacant_clean" || room.type !== reservation.roomType) {
          throw new ApiError(409, "ROOM_NOT_READY", "Room must be clean, vacant, and match the reserved type");
        }
        const conflicting = db.prepare(`
          SELECT id FROM reservation WHERE room_id = ? AND id != ?
          AND status NOT IN ('cancelled','checked_out','no_show')
          AND arrival < ? AND ? < departure LIMIT 1
        `).get(command.roomId, reservationId, reservation.departure, reservation.arrival);
        if (conflicting) throw new ApiError(409, "ROOM_ALREADY_ASSIGNED", "Room is assigned to an overlapping reservation");
        db.prepare("UPDATE reservation SET status='checked_in', room_id=?, version=version+1 WHERE id=?").run(command.roomId, reservationId);
        db.prepare("UPDATE room SET status='occupied', version=version+1 WHERE id=?").run(command.roomId);
        recordChange("checked_in", "reservation", reservationId, actor(session), command.reason, `${reservation.guestName} checked into room ${room.number}`, correlationId, session.user.propertyId);
      }
      if (action === "postings") {
        if (reservation.status !== "checked_in") throw new ApiError(409, "INVALID_RESERVATION_STATE", "Charges can be posted only to an in-house stay");
        if (!command.amount || !command.description || !command.code) throw new ApiError(422, "POSTING_FIELDS_REQUIRED", "Amount, code, and description are required");
        db.prepare("INSERT INTO folio_entry VALUES (?, ?, 'charge', ?, ?, ?, ?, ?)").run(
          randomUUID(), reservationId, command.code, command.description, command.amount, new Date().toISOString(), command.idempotencyKey ?? randomUUID()
        );
        recordChange("charge_posted", "folio", reservationId, actor(session), command.reason, `${command.description} · ${command.amount.toFixed(2)}`, correlationId, session.user.propertyId);
      }
      if (action === "payment") {
        if (!["confirmed", "checked_in"].includes(reservation.status)) throw new ApiError(409, "INVALID_RESERVATION_STATE", "Payment cannot be posted in the current state");
        if (!command.amount || !command.tokenLast4 || !command.idempotencyKey) throw new ApiError(422, "PAYMENT_FIELDS_REQUIRED", "Amount, token reference, and idempotency key are required");
        db.prepare("INSERT OR IGNORE INTO folio_entry VALUES (?, ?, 'payment', 'CARD', ?, ?, ?, ?)").run(
          randomUUID(), reservationId, `Tokenized card ···· ${command.tokenLast4}`, command.amount, new Date().toISOString(), command.idempotencyKey
        );
        recordChange("payment_captured", "payment", reservationId, actor(session), command.reason, `Tokenized payment · ${command.amount.toFixed(2)}`, correlationId, session.user.propertyId);
      }
      if (action === "checkout") {
        const current = findReservation(reservationId, session.user.propertyId);
        if (current.status !== "checked_in") throw new ApiError(409, "INVALID_RESERVATION_STATE", "Only in-house reservations can be checked out");
        if (Math.abs(current.balance) > 0.009) throw new ApiError(409, "FOLIO_NOT_SETTLED", `Settle the folio balance of ${current.balance.toFixed(2)} before checkout`);
        db.prepare("UPDATE reservation SET status='checked_out', version=version+1 WHERE id=?").run(reservationId);
        if (current.roomId) db.prepare("UPDATE room SET status='vacant_dirty', version=version+1 WHERE id=?").run(current.roomId);
        recordChange("checked_out", "reservation", reservationId, actor(session), command.reason, `${current.guestName} checked out; room released dirty`, correlationId, session.user.propertyId);
      }
      return findReservation(reservationId, session.user.propertyId);
    });
    return json(response, 200, result, correlationId);
  }

  const roomCommand = url.pathname.match(/^\/api\/rooms\/([^/]+)\/status$/);
  if (request.method === "PATCH" && roomCommand) {
    requirePermission(session, "room.update");
    const body = z.object({
      status: z.enum(["vacant_clean", "vacant_dirty", "out_of_order"]),
      reason: z.string().min(3)
    }).parse(await readJson(request));
    transaction(() => {
      const room = db.prepare("SELECT * FROM room WHERE id=? AND property_id=?").get(roomCommand[1], session.user.propertyId) as Record<string, unknown> | undefined;
      if (!room) throw new ApiError(404, "ROOM_NOT_FOUND", "Room not found");
      if (room.status === "occupied") throw new ApiError(409, "ROOM_OCCUPIED", "An occupied room cannot be changed through housekeeping status");
      db.prepare("UPDATE room SET status=?, version=version+1 WHERE id=?").run(body.status, roomCommand[1]);
      recordChange("status_changed", "room", roomCommand[1], actor(session), body.reason, `Room ${room.number}: ${room.status} → ${body.status}`, correlationId, session.user.propertyId);
    });
    return json(response, 200, scopeDashboard(rowsToDashboard(session.user.propertyId), session), correlationId);
  }

  const serviceCommand = url.pathname.match(/^\/api\/services\/([^/]+)\/book$/);
  if (request.method === "POST" && serviceCommand) {
    requirePermission(session, "service.book");
    const input = z.object({
      reservationId: z.string().nullable().default(null),
      guestName: z.string().trim().min(2).max(120),
      serviceDate: z.string().date(),
      slot: z.string().regex(/^\d{2}:\d{2}$/),
      participants: z.number().int().min(1).max(100),
      youngestAge: z.number().int().min(0).max(120),
      waiverAccepted: z.boolean().default(false),
      idempotencyKey: z.string().min(8).max(100)
    }).parse(await readJson(request));
    const booking = transaction(() => {
      const existing = db.prepare("SELECT * FROM service_booking WHERE idempotency_key=? AND property_id=?").get(input.idempotencyKey, session.user.propertyId) as Record<string, unknown> | undefined;
      if (existing) return existing;
      const service = db.prepare("SELECT * FROM service_offering WHERE id=? AND property_id=? AND active=1").get(serviceCommand[1], session.user.propertyId) as Record<string, unknown> | undefined;
      if (!service) throw new ApiError(404, "SERVICE_NOT_FOUND", "Service offering not found");
      const slots = parseJson<string[]>(service.slots_json);
      if (!slots.includes(input.slot)) throw new ApiError(422, "INVALID_SERVICE_SLOT", "The selected time is not offered");
      if (input.youngestAge < Number(service.min_age)) throw new ApiError(422, "AGE_RESTRICTION", `Minimum participant age is ${service.min_age}`);
      if (Boolean(service.requires_waiver) && !input.waiverAccepted) throw new ApiError(422, "WAIVER_REQUIRED", "A safety waiver is required for this activity");
      const reserved = Number((db.prepare(`SELECT COALESCE(SUM(participants),0) AS total FROM service_booking WHERE property_id=? AND service_id=? AND service_date=? AND slot=? AND status='confirmed'`).get(session.user.propertyId, serviceCommand[1], input.serviceDate, input.slot) as { total: number }).total);
      if (reserved + input.participants > Number(service.capacity_per_slot)) throw new ApiError(409, "SERVICE_CAPACITY_EXCEEDED", "The selected activity slot does not have enough capacity");
      if (input.reservationId) findReservation(input.reservationId, session.user.propertyId);
      const id = randomUUID();
      const total = Math.round(Number(service.price) * input.participants * 100) / 100;
      const now = new Date().toISOString();
      db.prepare("INSERT INTO service_booking VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?)").run(id, session.user.propertyId, serviceCommand[1], input.reservationId, input.guestName, input.serviceDate, input.slot, input.participants, total, now, input.idempotencyKey);
      if (input.reservationId) {
        db.prepare("INSERT OR IGNORE INTO folio_entry VALUES (?, ?, 'charge', 'ANC', ?, ?, ?, ?)").run(randomUUID(), input.reservationId, String(service.name), total, now, `service-${input.idempotencyKey}`);
      }
      recordChange("service_booked", "service_booking", id, actor(session), "Guest service reservation", `${service.name} · ${input.participants} participant(s)`, correlationId, session.user.propertyId);
      return db.prepare("SELECT * FROM service_booking WHERE id=?").get(id) as Record<string, unknown>;
    });
    return json(response, 201, { id: booking.id }, correlationId);
  }

  const housekeepingCommand = url.pathname.match(/^\/api\/housekeeping\/tasks\/([^/]+)$/);
  if (request.method === "PATCH" && housekeepingCommand) {
    requirePermission(session, "housekeeping.update");
    const input = z.object({ status: z.enum(["queued", "in_progress", "inspection", "completed"]), reason: z.string().min(3).max(240) }).parse(await readJson(request));
    transaction(() => {
      const task = db.prepare("SELECT * FROM housekeeping_task WHERE id=? AND property_id=?").get(housekeepingCommand[1], session.user.propertyId) as Record<string, unknown> | undefined;
      if (!task) throw new ApiError(404, "HOUSEKEEPING_TASK_NOT_FOUND", "Housekeeping task not found");
      db.prepare("UPDATE housekeeping_task SET status=? WHERE id=? AND property_id=?").run(input.status, housekeepingCommand[1], session.user.propertyId);
      if (input.status === "completed" && ["checkout_clean", "inspection", "deep_clean"].includes(String(task.type))) {
        db.prepare("UPDATE room SET status='vacant_clean', version=version+1 WHERE id=? AND property_id=? AND status!='occupied'").run(String(task.room_id), session.user.propertyId);
      }
      recordChange("task_status_changed", "housekeeping", housekeepingCommand[1], actor(session), input.reason, `${task.type}: ${task.status} → ${input.status}`, correlationId, session.user.propertyId);
    });
    return json(response, 200, scopeDashboard(rowsToDashboard(session.user.propertyId), session), correlationId);
  }

  const inventoryCommand = url.pathname.match(/^\/api\/inventory\/([^/]+)\/movements$/);
  if (request.method === "POST" && inventoryCommand) {
    requirePermission(session, "inventory.update");
    const input = z.object({
      type: z.enum(["receipt", "issue"]), quantity: z.number().positive().max(1_000_000),
      department: z.string().min(2).max(80), reference: z.string().min(2).max(80),
      reason: z.string().min(3).max(240), idempotencyKey: z.string().min(8).max(100)
    }).parse(await readJson(request));
    transaction(() => {
      const duplicate = db.prepare("SELECT id FROM stock_movement WHERE idempotency_key=?").get(input.idempotencyKey);
      if (duplicate) return;
      const item = db.prepare("SELECT * FROM inventory_item WHERE id=? AND property_id=?").get(inventoryCommand[1], session.user.propertyId) as Record<string, unknown> | undefined;
      if (!item) throw new ApiError(404, "INVENTORY_ITEM_NOT_FOUND", "Inventory item not found");
      const nextOnHand = projectedOnHand(Number(item.on_hand), input.type, input.quantity);
      if (nextOnHand < 0) throw new ApiError(409, "INSUFFICIENT_STOCK", `Only ${item.on_hand} ${item.unit} is available`);
      const now = new Date().toISOString();
      const movementId = randomUUID();
      db.prepare("INSERT INTO stock_movement VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(movementId, session.user.propertyId, inventoryCommand[1], input.type, input.quantity, Number(item.unit_cost), input.department, input.reference, now, input.idempotencyKey);
      db.prepare("UPDATE inventory_item SET on_hand=? WHERE id=? AND property_id=?").run(nextOnHand, inventoryCommand[1], session.user.propertyId);
      const amount = Math.round(input.quantity * Number(item.unit_cost) * 100) / 100;
      const lines = input.type === "receipt"
        ? [{ accountCode: "1300", accountName: "Operating inventory", costCenter: "Stores", debit: amount, credit: 0 }, { accountCode: "2100", accountName: "Accrued payables", costCenter: "Finance", debit: 0, credit: amount }]
        : [{ accountCode: "5100", accountName: "Department supplies expense", costCenter: input.department, debit: amount, credit: 0 }, { accountCode: "1300", accountName: "Operating inventory", costCenter: "Stores", debit: 0, credit: amount }];
      if (!journalBalances(lines)) throw new ApiError(500, "JOURNAL_OUT_OF_BALANCE", "Generated inventory journal is not balanced");
      const journalNumber = `JE-${Date.now().toString().slice(-9)}`;
      db.prepare("INSERT INTO journal_entry VALUES (?, ?, ?, ?, 'Inventory', ?, 'posted', ?)").run(randomUUID(), session.user.propertyId, journalNumber, rowsToDashboard(session.user.propertyId).businessDate, `${input.type} ${item.name} · ${input.reference}`, JSON.stringify(lines));
      recordChange("stock_moved", "inventory", inventoryCommand[1], actor(session), input.reason, `${input.type} ${input.quantity} ${item.unit} · ${item.name}`, correlationId, session.user.propertyId);
    });
    return json(response, 200, scopeDashboard(rowsToDashboard(session.user.propertyId), session), correlationId);
  }

  const rateRuleCommand = url.pathname.match(/^\/api\/rate-rules\/([^/]+)$/);
  if (request.method === "PATCH" && rateRuleCommand) {
    requirePermission(session, "rate.update");
    const input = z.object({ active: z.boolean(), reason: z.string().min(3).max(240) }).parse(await readJson(request));
    const result = db.prepare("UPDATE rate_rule SET active=? WHERE id=? AND property_id=?").run(Number(input.active), rateRuleCommand[1], session.user.propertyId);
    if (!result.changes) throw new ApiError(404, "RATE_RULE_NOT_FOUND", "Rate rule not found");
    recordChange("rate_rule_changed", "pricing", rateRuleCommand[1], actor(session), input.reason, `Rate rule ${input.active ? "activated" : "paused"}`, correlationId, session.user.propertyId);
    return json(response, 200, scopeDashboard(rowsToDashboard(session.user.propertyId), session), correlationId);
  }

  const guestCommand = url.pathname.match(/^\/api\/guests\/([^/]+)$/);
  if (request.method === "PATCH" && guestCommand) {
    requirePermission(session, "crm.update");
    const input = z.object({ tags: z.array(z.string().min(1).max(40)).max(20), preferences: z.array(z.string().min(1).max(80)).max(30), reason: z.string().min(3).max(240) }).parse(await readJson(request));
    const result = db.prepare("UPDATE guest_profile SET tags_json=?, preferences_json=? WHERE id=? AND property_id=?").run(JSON.stringify(input.tags), JSON.stringify(input.preferences), guestCommand[1], session.user.propertyId);
    if (!result.changes) throw new ApiError(404, "GUEST_NOT_FOUND", "Guest profile not found");
    recordChange("profile_updated", "crm", guestCommand[1], actor(session), input.reason, "Guest preferences and tags updated", correlationId, session.user.propertyId);
    return json(response, 200, scopeDashboard(rowsToDashboard(session.user.propertyId), session), correlationId);
  }

  if (request.method === "POST" && url.pathname === "/api/night-audit") {
    requirePermission(session, "audit.run");
    const body = z.object({ reason: z.string().min(3) }).parse(await readJson(request));
    const nextDate = transaction(() => {
      const dashboard = rowsToDashboard(session.user.propertyId);
      const dueOut = dashboard.reservations.filter((r) => r.departure <= dashboard.businessDate && r.status === "checked_in");
      const unsettled = dueOut.filter((r) => Math.abs(r.balance) > 0.009);
      if (dueOut.length) {
        throw new ApiError(409, "NIGHT_AUDIT_BLOCKED", `${dueOut.length} due-out stay(s) remain in house; ${unsettled.length} have unsettled folios`);
      }
      const next = plusDays(dashboard.businessDate, 1);
      db.prepare("UPDATE property SET business_date=? WHERE id=?").run(next, session.user.propertyId);
      recordChange("business_date_closed", "night_audit", dashboard.businessDate, actor(session), body.reason, `Business date advanced to ${next}`, correlationId, session.user.propertyId);
      return next;
    });
    return json(response, 200, { businessDate: nextDate }, correlationId);
  }

  throw new ApiError(404, "ROUTE_NOT_FOUND", "API route not found");
}

const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json"
};

let vite: Awaited<ReturnType<(typeof import("vite"))["createServer"]>> | undefined;
if (process.env.NODE_ENV !== "production") {
  const { createServer: createViteServer } = await import("vite");
  vite = await createViteServer({ root: ROOT, server: { middlewareMode: true }, appType: "spa" });
}

const server = createServer(async (request, response) => {
  const correlationId = request.headers["x-correlation-id"]?.toString() ?? randomUUID();
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url, correlationId);
      return;
    }
    if (vite) {
      vite.middlewares(request, response, () => {
        if (!response.writableEnded) response.end();
      });
      return;
    }
    const dist = join(ROOT, "dist");
    const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const file = join(dist, requested);
    const safeFile = file.startsWith(dist) && existsSync(file) ? file : join(dist, "index.html");
    response.writeHead(200, {
      "content-type": mimeTypes[extname(safeFile)] ?? "application/octet-stream",
      "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin"
    });
    response.end(readFileSync(safeFile));
  } catch (error) {
    const apiError = error instanceof ApiError
      ? error
      : error instanceof ZodError
        ? new ApiError(422, "VALIDATION_ERROR", error.issues[0]?.message ?? "Invalid request")
        : error instanceof SyntaxError
          ? new ApiError(400, "INVALID_JSON", "Request body is not valid JSON")
          : new ApiError(500, "INTERNAL_ERROR", "The operation could not be completed");
    if (!(error instanceof ApiError || error instanceof ZodError || error instanceof SyntaxError)) {
      console.error(correlationId, error);
    }
    json(response, apiError.status, { error: { code: apiError.code, message: apiError.message, correlationId } }, correlationId);
  }
});

server.listen(PORT, () => {
  console.log(`Aurelia Hospitality OS running at http://localhost:${PORT}`);
});
