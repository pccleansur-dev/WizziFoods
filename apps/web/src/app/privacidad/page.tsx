import type { Metadata } from "next";

import { LegalPage } from "../legal-page";

export const metadata: Metadata = {
  description:
    "Cómo Wizzi Foods recopila, utiliza, conserva y protege la información de sus usuarios.",
  title: "Política de Privacidad | Wizzi Foods"
};

export default function PrivacyPage() {
  return (
    <LegalPage
      description="Esta política explica qué información trata Wizzi Foods, para qué la usa y qué opciones tienen las personas que utilizan la plataforma."
      title="Política de Privacidad"
    >
      <section aria-labelledby="privacy-scope">
        <h2 id="privacy-scope">1. Alcance y responsable</h2>
        <p>
          Wizzi Foods es una plataforma tecnológica para negocios gastronómicos.
          Esta política se aplica a sus sitios, paneles de administración,
          accesos del personal, cartas digitales y funciones para comensales.
        </p>
        <p>
          Para consultas sobre privacidad o para ejercer derechos sobre tus
          datos, escribinos a{" "}
          <a href="mailto:dev@wizzi.com.ar">dev@wizzi.com.ar</a>.
        </p>
      </section>

      <section aria-labelledby="privacy-data">
        <h2 id="privacy-data">2. Información que tratamos</h2>
        <ul>
          <li>
            <strong>Cuenta e identidad:</strong> correo electrónico, nombre,
            identificadores de inicio de sesión, roles y factores de seguridad.
          </li>
          <li>
            <strong>Negocio y operación:</strong> perfil del establecimiento,
            carta, mesas, pedidos, caja, personal y configuraciones cargadas por
            sus responsables.
          </li>
          <li>
            <strong>Comensales:</strong> datos de perfil y preferencias cuando
            la persona decide crear o utilizar una cuenta.
          </li>
          <li>
            <strong>Datos técnicos:</strong> dirección IP, dispositivo,
            navegador, registros de seguridad, errores y actividad necesaria
            para operar y proteger el servicio.
          </li>
        </ul>
      </section>

      <section aria-labelledby="privacy-purpose">
        <h2 id="privacy-purpose">3. Para qué usamos la información</h2>
        <p>Tratamos la información para:</p>
        <ul>
          <li>prestar, mantener y mejorar las funciones contratadas;</li>
          <li>autenticar usuarios y administrar permisos por negocio;</li>
          <li>procesar pedidos, pagos y comunicaciones habilitadas;</li>
          <li>prevenir abuso, fraude e incidentes de seguridad;</li>
          <li>brindar soporte y cumplir obligaciones legales.</li>
        </ul>
      </section>

      <section aria-labelledby="privacy-google">
        <h2 id="privacy-google">4. Inicio de sesión con Google</h2>
        <p>
          Si elegís continuar con Google, recibimos de Google la información
          básica autorizada para identificar tu cuenta, como correo electrónico,
          nombre e identificador de usuario. Wizzi Foods no recibe ni almacena
          tu contraseña de Google. Podés revisar o revocar este acceso desde la
          configuración de tu cuenta de Google.
        </p>
      </section>

      <section aria-labelledby="privacy-sharing">
        <h2 id="privacy-sharing">5. Proveedores y transferencias</h2>
        <p>
          Podemos usar proveedores de infraestructura, autenticación,
          mensajería, notificaciones y pagos para prestar el servicio. Sólo
          compartimos la información necesaria para la función correspondiente y
          exigimos medidas de seguridad adecuadas. Algunas integraciones se
          activan únicamente cuando el negocio decide configurarlas.
        </p>
        <p>
          No vendemos datos personales ni los compartimos con fines de
          publicidad ajenos a Wizzi Foods.
        </p>
      </section>

      <section aria-labelledby="privacy-retention">
        <h2 id="privacy-retention">6. Conservación y seguridad</h2>
        <p>
          Conservamos la información mientras la cuenta o el servicio estén
          activos y durante el tiempo necesario para responder obligaciones
          legales, prevenir fraude y resolver disputas. Aplicamos controles de
          acceso, cifrado en tránsito, separación entre negocios, copias de
          seguridad y registros de auditoría acordes al riesgo.
        </p>
      </section>

      <section aria-labelledby="privacy-rights">
        <h2 id="privacy-rights">7. Tus derechos</h2>
        <p>
          Podés solicitar acceso, actualización, corrección o eliminación de tus
          datos, así como retirar consentimientos cuando corresponda. Para
          protegerte, podremos pedirte que verifiques tu identidad antes de
          responder. Enviá tu solicitud a{" "}
          <a href="mailto:dev@wizzi.com.ar">dev@wizzi.com.ar</a>.
        </p>
      </section>

      <section aria-labelledby="privacy-changes">
        <h2 id="privacy-changes">8. Cambios a esta política</h2>
        <p>
          Podemos actualizar esta política cuando cambien el servicio o las
          normas aplicables. Publicaremos la nueva versión en esta página e
          indicaremos su fecha de vigencia.
        </p>
      </section>
    </LegalPage>
  );
}
