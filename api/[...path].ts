import type { IncomingMessage, ServerResponse } from "node:http";

import { handleRequest } from "../src/server";

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  try {
    await handleRequest(request, response);
  } catch (error) {
    console.error("Vercel API request failed", error);
    if (response.headersSent) {
      response.destroy(error instanceof Error ? error : undefined);
      return;
    }

    response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({
      ok: false,
      errorCode: "INTERNAL_SERVER_ERROR",
      error: "Internal server error",
    }));
  }
}
