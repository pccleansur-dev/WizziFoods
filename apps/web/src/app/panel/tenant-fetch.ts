import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

type TenantFetchInit = {
  body?: string;
  cache?: RequestCache;
  headers: Record<string, string>;
  method?: string;
};

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
  const target = new URL(url);
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
