import type { Metadata } from "next";

import { LegalPage } from "../legal-page";

export const metadata: Metadata = {
  description:
    "Condiciones aplicables al acceso y uso de la plataforma gastronómica Wizzi Foods.",
  title: "Condiciones del Servicio | Wizzi Foods"
};

export default function TermsPage() {
  return (
    <LegalPage
      description="Estas condiciones regulan el acceso y uso de Wizzi Foods por negocios gastronómicos, su personal y los comensales."
      title="Condiciones del Servicio"
    >
      <section aria-labelledby="terms-acceptance">
        <h2 id="terms-acceptance">1. Aceptación</h2>
        <p>
          Al acceder o utilizar Wizzi Foods aceptás estos términos y nuestra
          Política de Privacidad. Si actuás en nombre de un negocio, declarás
          tener autorización suficiente para vincularlo a estas condiciones.
        </p>
      </section>

      <section aria-labelledby="terms-service">
        <h2 id="terms-service">2. El servicio</h2>
        <p>
          Wizzi Foods ofrece herramientas para administrar cartas digitales,
          salón, cocina, caja, pagos, fidelización y comunicaciones. Algunas
          funciones dependen de integraciones o planes específicos y pueden no
          estar disponibles en todos los casos.
        </p>
      </section>

      <section aria-labelledby="terms-accounts">
        <h2 id="terms-accounts">3. Cuentas y seguridad</h2>
        <p>
          Cada persona debe usar una cuenta propia, mantener sus credenciales y
          factores de autenticación protegidos, y notificarnos ante accesos no
          autorizados. Los responsables del negocio administran los roles y
          permisos de su personal y deben revocarlos cuando dejan de ser
          necesarios.
        </p>
      </section>

      <section aria-labelledby="terms-business">
        <h2 id="terms-business">4. Responsabilidades del negocio</h2>
        <p>
          El negocio es responsable de la exactitud de su carta, precios,
          disponibilidad, información comercial, obligaciones fiscales,
          bromatológicas, laborales y de atención al consumidor. Wizzi Foods no
          reemplaza sus sistemas contables ni el asesoramiento profesional que
          corresponda.
        </p>
      </section>

      <section aria-labelledby="terms-diners">
        <h2 id="terms-diners">5. Comensales</h2>
        <p>
          La consulta de una carta puede realizarse sin crear una cuenta. Las
          funciones de perfil, preferencias o fidelización son opcionales. Cada
          pedido o pago constituye una relación entre el comensal y el negocio
          que lo recibe, salvo que se indique expresamente otra cosa.
        </p>
      </section>

      <section aria-labelledby="terms-integrations">
        <h2 id="terms-integrations">6. Integraciones de terceros</h2>
        <p>
          Google, proveedores de pagos, WhatsApp, notificaciones y otros
          servicios externos tienen sus propios términos y políticas. Wizzi
          Foods facilita la integración, pero no controla la disponibilidad ni
          las decisiones de esos proveedores.
        </p>
      </section>

      <section aria-labelledby="terms-use">
        <h2 id="terms-use">7. Uso permitido</h2>
        <p>No está permitido:</p>
        <ul>
          <li>usar el servicio con fines ilegales, fraudulentos o abusivos;</li>
          <li>intentar acceder a datos de otro negocio o usuario;</li>
          <li>interferir con la seguridad, estabilidad o disponibilidad;</li>
          <li>cargar contenido que vulnere derechos de terceros;</li>
          <li>revender o copiar la plataforma sin autorización.</li>
        </ul>
      </section>

      <section aria-labelledby="terms-availability">
        <h2 id="terms-availability">8. Disponibilidad y modificaciones</h2>
        <p>
          Trabajamos para mantener el servicio disponible y seguro, pero pueden
          existir mantenimientos, incidentes o dependencias externas. Podemos
          modificar funciones para mejorar la plataforma, cumplir normas o
          proteger a sus usuarios, procurando comunicar cambios relevantes.
        </p>
      </section>

      <section aria-labelledby="terms-suspension">
        <h2 id="terms-suspension">9. Suspensión y finalización</h2>
        <p>
          Podemos limitar o suspender una cuenta ante incumplimientos, riesgos
          de seguridad, falta de pago o requerimientos legales. El titular puede
          solicitar la baja y exportación de la información disponible conforme
          al plan y a las obligaciones de conservación aplicables.
        </p>
      </section>

      <section aria-labelledby="terms-liability">
        <h2 id="terms-liability">10. Responsabilidad</h2>
        <p>
          En la máxima medida permitida por la ley, Wizzi Foods no responde por
          decisiones comerciales del negocio, contenido cargado por usuarios,
          interrupciones de terceros ni daños indirectos. Nada en estos términos
          limita derechos irrenunciables reconocidos por la legislación
          aplicable.
        </p>
      </section>

      <section aria-labelledby="terms-law">
        <h2 id="terms-law">11. Ley aplicable y contacto</h2>
        <p>
          Estos términos se interpretan conforme a las leyes de la República
          Argentina. Para consultas, reclamos o notificaciones escribinos a{" "}
          <a href="mailto:dev@wizzi.com.ar">dev@wizzi.com.ar</a>.
        </p>
      </section>
    </LegalPage>
  );
}
