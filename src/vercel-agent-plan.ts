import type { IncomingMessage, ServerResponse } from "node:http";

import dispatch from "./vercel-handler";

export default function handleAgentPlan(
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  return dispatch(request, response);
}
