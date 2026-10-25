import { proxyOnlinePayment } from "../../payment-proxy";

export async function POST(request: Request): Promise<Response> {
  return proxyOnlinePayment(request, "/share/status");
}
