import { proxyDiner } from "../../diner-proxy";

export function PUT(request: Request): Promise<Response> {
  return proxyDiner(request, {
    method: "PUT",
    path: "/v1/public/diner/loyalty/birthday"
  });
}
