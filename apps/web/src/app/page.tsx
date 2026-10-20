import { createServiceStatus } from "@platform/contracts";

export default function HomePage() {
  const service = createServiceStatus("web");

  return (
    <main>
      <section aria-labelledby="page-title">
        <p className="eyebrow">La plataforma</p>
        <h1 id="page-title">Base técnica lista</h1>
        <p>
          El frontend ya comparte contratos con la API y el worker. El próximo
          corte incorporará Supabase y el entorno local reproducible.
        </p>
        <dl>
          <div>
            <dt>Servicio</dt>
            <dd>{service.service}</dd>
          </div>
          <div>
            <dt>Estado</dt>
            <dd>{service.status}</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
