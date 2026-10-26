import { proxyDiner } from "../diner-proxy";

export function POST(request: Request): Promise<Response> {
  return proxyDiner(request, {
    method: "POST",
    path: "/v1/public/diner/consents"
  });
}
