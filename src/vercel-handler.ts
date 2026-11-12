import type { IncomingMessage, ServerResponse } from "node:http";

function sendError(
  response: ServerResponse,
  errorCode: string,
  message: string
): void {
  if (response.headersSent) {
    response.destroy();
    return;
  }

  response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ ok: false, errorCode, error: message }));
}

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  let handleRequest: typeof import("./server").handleRequest;
  try {
    ({ handleRequest } = await import("./server"));
  } catch (error) {
    console.error("Vercel backend initialization failed", error);
    sendError(response, "BACKEND_INITIALIZATION_FAILED", "Backend initialization failed.");
    return;
  }

  try {
    await handleRequest(request, response);
  } catch (error) {
    console.error("Vercel API request failed", error);
    sendError(response, "INTERNAL_SERVER_ERROR", "Internal server error.");
  }
}
