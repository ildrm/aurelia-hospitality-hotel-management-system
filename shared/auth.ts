export const permissions = [
  "dashboard.read",
  "reservation.read",
  "reservation.create",
  "reservation.checkin",
  "room.read",
  "room.update",
  "folio.read",
  "folio.post",
  "payment.capture",
  "stay.checkout",
  "audit.read",
  "audit.run",
  "catalog.read",
  "rate.read",
  "rate.update",
  "service.read",
  "service.book",
  "housekeeping.read",
  "housekeeping.update",
  "inventory.read",
  "inventory.update",
  "accounting.read",
  "accounting.post",
  "crm.read",
  "crm.update",
  "affiliate.read",
  "affiliate.update"
] as const;

export type Permission = (typeof permissions)[number];
export type Role = "general_manager" | "front_desk" | "reservations" | "housekeeping" | "night_auditor" | "accountant" | "inventory_manager" | "revenue_manager" | "crm_manager" | "activities_manager";

export const rolePermissions: Record<Role, readonly Permission[]> = {
  general_manager: permissions,
  front_desk: [
    "dashboard.read", "reservation.read", "reservation.create", "reservation.checkin",
    "room.read", "folio.read", "folio.post", "payment.capture", "stay.checkout",
    "catalog.read", "rate.read", "service.read", "service.book", "housekeeping.read", "crm.read"
  ],
  reservations: ["dashboard.read", "reservation.read", "reservation.create", "room.read", "catalog.read", "rate.read", "service.read", "service.book", "crm.read"],
  housekeeping: ["dashboard.read", "room.read", "room.update", "housekeeping.read", "housekeeping.update", "inventory.read"],
  night_auditor: ["dashboard.read", "reservation.read", "room.read", "folio.read", "audit.read", "audit.run", "housekeeping.read", "inventory.read", "accounting.read"],
  accountant: ["dashboard.read", "reservation.read", "folio.read", "folio.post", "payment.capture", "audit.read", "inventory.read", "accounting.read", "accounting.post", "affiliate.read"],
  inventory_manager: ["dashboard.read", "inventory.read", "inventory.update", "accounting.read", "housekeeping.read"],
  revenue_manager: ["dashboard.read", "reservation.read", "catalog.read", "rate.read", "rate.update", "service.read", "affiliate.read", "affiliate.update"],
  crm_manager: ["dashboard.read", "reservation.read", "service.read", "crm.read", "crm.update", "affiliate.read"],
  activities_manager: ["dashboard.read", "reservation.read", "service.read", "service.book", "crm.read"]
};

export const roleLabels: Record<Role, string> = {
  general_manager: "General Manager",
  front_desk: "Front Desk Manager",
  reservations: "Reservations Agent",
  housekeeping: "Housekeeping Supervisor",
  night_auditor: "Night Auditor",
  accountant: "Hotel Accountant",
  inventory_manager: "Inventory Manager",
  revenue_manager: "Revenue Manager",
  crm_manager: "CRM Manager",
  activities_manager: "Ancillary & Venue Manager"
};

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  roleLabel: string;
  propertyId: string;
  permissions: Permission[];
  initials: string;
}

export interface AuthSession {
  user: AuthUser;
  csrfToken: string;
}

export function can(user: AuthUser, permission: Permission): boolean {
  return user.permissions.includes(permission);
}
