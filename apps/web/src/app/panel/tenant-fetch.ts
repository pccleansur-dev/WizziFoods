import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

type TenantFetchInit = {
  body?: string;
  cache?: RequestCache;
  headers: Record<string, string>;
  method?: string;
};

/**
 * En producción la URL pública de la API (`NEXT_PUBLIC_API_URL`) pasa por un proxy que enruta por
 * `Host`: una solicitud con el `Host` del negocio terminaría en la web y no en la API. El servidor
 * web alcanza a la API por la red interna (`API_URL`), donde el `Host` llega intacto. Solo se
 * reescribe el origen cuando el destino es la URL pública configurada de la API.
 */
function reachableTarget(url: string): URL {
  const target = new URL(url);
  const internal = process.env.API_URL;
  const publicUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!internal || !publicUrl) return target;
  try {
    if (target.origin !== new URL(publicUrl).origin) return target;
    return new URL(`${target.pathname}${target.search}`, new URL(internal));
  } catch {
    return target;
  }
}

/**
 * Llama a la API enviando la cabecera `Host` del tenant tal cual.
 *
 * `fetch` de Node/undici descarta `Host`, y la API resuelve el tenant desde
 * `request.headers.host`. Por eso las llamadas administrativas usan `node:http`,
 * que sí respeta la cabecera. La API sigue autenticando el Bearer del usuario y
 * validando que pertenezca al tenant del host: aquí no se envía ningún
 * `tenantId`/`locationId` ni cabeceras de reenvío.
 */
export function tenantFetch(
  url: string,
  init: TenantFetchInit
): Promise<Response> {
  const target = reachableTarget(url);
  const send = target.protocol === "https:" ? httpsRequest : httpRequest;
  const body = init.body === undefined ? undefined : Buffer.from(init.body);
  return new Promise((resolve, reject) => {
    const req = send(
      target,
      {
        headers: {
          ...init.headers,
          ...(body ? { "content-length": String(body.length) } : {})
        },
        method: init.method ?? "GET"
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("error", reject);
        res.on("end", () => {
          const headers = new Headers();
          for (const [name, value] of Object.entries(res.headers)) {
            if (Array.isArray(value)) {
              for (const item of value) headers.append(name, item);
            } else if (value !== undefined) {
              headers.set(name, value);
            }
          }
          const status = res.statusCode ?? 502;
          const hasBody = status !== 204 && status !== 205 && status !== 304;
          resolve(
            new Response(hasBody ? Buffer.concat(chunks) : null, {
              headers,
              status,
              ...(res.statusMessage ? { statusText: res.statusMessage } : {})
            })
          );
        });
      }
    );
    req.on("error", reject);
    req.end(body);
  });
}
