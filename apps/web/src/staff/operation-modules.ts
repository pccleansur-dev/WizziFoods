import type { StaffCapability, StaffRole } from "@platform/contracts";

export type StaffOperationModule = {
  description: string;
  /** Route under /interno/<tenant>/operacion, when the module already exists. */
  path?: string;
  requiredCapability: StaffCapability;
  title: string;
};

const modules: readonly StaffOperationModule[] = [
  {
    description: "Disponibilidad, productos, precios y categorías.",
    requiredCapability: "menu.manage",
    title: "Carta"
  },
  {
    description: "Distribución, estado y preparación de mesas.",
    requiredCapability: "salon.manage",
    title: "Salón"
  },
  {
    description: "Llamados activos y atención de cada mesa.",
    path: "salon",
    requiredCapability: "calls.manage",
    title: "Mesas y llamados"
  },
  {
    description: "Carga, validación y seguimiento de pedidos.",
    path: "salon?vista=comanda",
    requiredCapability: "orders.manage",
    title: "Pedidos"
  },
  {
    description: "Consumos pendientes y registro de cobros.",
    requiredCapability: "payments.collect",
    title: "Cobros"
  },
  {
    description: "Cola de preparación y estados de cocina.",
    path: "produccion",
    requiredCapability: "production.kitchen.manage",
    title: "Cocina"
  },
  {
    description: "Cola de preparación y estados de barra.",
    path: "produccion",
    requiredCapability: "production.bar.manage",
    title: "Barra"
  }
];

export function operationModulesFor(
  _role: StaffRole,
  capabilities: readonly StaffCapability[]
): StaffOperationModule[] {
  void _role;
  return modules.filter((module) =>
    capabilities.includes(module.requiredCapability)
  );
}
