import { clearSessionCookie, proxyDiner } from "../diner-proxy";

/** Anonymizes the account; the browser forgets the session either way. */
export async function DELETE(request: Request): Promise<Response> {
  const response = await proxyDiner(request, {
    method: "DELETE",
    path: "/v1/public/diner/account"
  });
  if (response.status === 204) {
    response.headers.append("set-cookie", clearSessionCookie());
  }
  return response;
}
