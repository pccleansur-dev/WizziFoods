import type { StaffCapability, StaffRole } from "@platform/contracts";

export type StaffOperationModule = {
  description: string;
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
    requiredCapability: "calls.manage",
    title: "Mesas y llamados"
  },
  {
    description: "Carga, validación y seguimiento de pedidos.",
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
    requiredCapability: "production.kitchen.manage",
    title: "Cocina"
  },
  {
    description: "Cola de preparación y estados de barra.",
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
