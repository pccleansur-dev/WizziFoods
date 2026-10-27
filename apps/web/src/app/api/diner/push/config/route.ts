import { proxyDiner } from "../../diner-proxy";

export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  return proxyDiner(request, {
    method: "GET",
    path: "/v1/public/diner/push/config"
  });
}
