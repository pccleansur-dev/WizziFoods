import { proxySplit } from "../split-proxy";

export async function POST(request: Request): Promise<Response> {
  return proxySplit(request, "view");
}
