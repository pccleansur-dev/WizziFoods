import { constants } from "node:fs";
import { access, open, readFile } from "node:fs/promises";
import path from "node:path";

import { createSupabaseEnvironment } from "./supabase-env.js";

const supabaseDirectory = path.resolve(process.cwd(), "infra", "supabase");
const templatePath = path.join(supabaseDirectory, ".env.example");
const environmentPath = path.join(supabaseDirectory, ".env");

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function setup(): Promise<void> {
  if (await fileExists(environmentPath)) {
    console.info(
      "Supabase ya tiene un archivo local de entorno; se conserva sin cambios."
    );
    return;
  }

  const template = await readFile(templatePath, "utf8");
  const environment = createSupabaseEnvironment(template);
  const file = await open(environmentPath, "wx", 0o600);

  try {
    await file.writeFile(environment, "utf8");
  } finally {
    await file.close();
  }

  console.info("Entorno local de Supabase creado sin exponer sus secretos.");
}

await setup();
