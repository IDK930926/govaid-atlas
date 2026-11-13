import type { IncomingMessage, ServerResponse } from "node:http";

import dispatch from "../src/vercel-handler";

export default function handleHealth(
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  return dispatch(request, response);
}
