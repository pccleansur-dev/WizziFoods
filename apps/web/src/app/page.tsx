import { redirect } from "next/navigation";

/**
 * La raíz no tiene contenido propio: el comensal entra por el QR de su mesa y el equipo por el
 * acceso. Si el ingreso con Google vuelve acá con un error, se conserva el aviso en /acceso.
 */
export default async function HomePage({
  searchParams
}: {
  searchParams: Promise<{ error?: string }>;
}): Promise<never> {
  const { error } = await searchParams;
  redirect(error ? "/acceso?error=no-se-pudo-validar" : "/acceso");
}
