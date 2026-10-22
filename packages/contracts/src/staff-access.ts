export const staffRoleLabels = {
  bar: "Barra",
  kitchen: "Cocina",
  manager: "Encargado",
  waiter: "Mozo"
} as const;

export type StaffRole = keyof typeof staffRoleLabels;

export type StaffCapability =
  | "calls.manage"
  | "menu.availability.manage"
  | "menu.manage"
  | "orders.manage"
  | "orders.validate"
  | "operations.approve"
  | "payments.collect"
  | "production.bar.manage"
  | "production.kitchen.manage"
  | "salon.manage"
  | "tables.serve";

export const STAFF_ROLE_CAPABILITIES = {
  manager: [
    "menu.manage",
    "menu.availability.manage",
    "salon.manage",
    "calls.manage",
    "tables.serve",
    "orders.manage",
    "orders.validate",
    "payments.collect",
    "operations.approve"
  ],
  waiter: [
    "calls.manage",
    "tables.serve",
    "orders.manage",
    "orders.validate",
    "payments.collect"
  ],
  kitchen: ["production.kitchen.manage"],
  bar: ["production.bar.manage"]
} as const satisfies Record<StaffRole, readonly StaffCapability[]>;

export const STAFF_AUTH_POLICY = {
  lockDurationMinutes: 15,
  maxFailedAttempts: 5,
  pinLength: 6,
  sensitiveRevalidationMinutes: 15,
  sessionDurationHours: 8
} as const;
