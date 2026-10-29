"use client";

import { useEffect, useRef, useState } from "react";

const failure = "/acceso?error=enlace-vencido";

export function InvitationFinish() {
  const [message, setMessage] = useState(
    "Un momento, estamos preparando tu acceso."
  );

  const started = useRef(false);

  useEffect(() => {
    // El efecto corre dos veces en desarrollo; la primera pasada ya borra el fragmento.
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    // El fragmento lleva credenciales: se borra de la barra y del historial antes de seguir.
    window.history.replaceState(null, "", window.location.pathname);

    if (!accessToken || !refreshToken) {
      window.location.replace(failure);
      return;
    }

    void fetch("/auth/invitacion/sesion", {
      body: JSON.stringify({ accessToken, refreshToken }),
      headers: { "content-type": "application/json" },
      method: "POST"
    })
      .then((response) => {
        if (response.ok) {
          setMessage("Listo. Ahora elegí tu contraseña.");
          window.location.replace("/acceso/restablecer?bienvenida=1");
        } else {
          window.location.replace(failure);
        }
      })
      .catch(() => window.location.replace(failure));
  }, []);

  return <p role="status">{message}</p>;
}
