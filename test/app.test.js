import assert from "node:assert/strict";
import { after, test } from "node:test";

process.env.CORS_ORIGINS = "http://localhost:3000";

const { default: app } = await import("../app.js");
const server = app.listen(0);
await new Promise((resolve) => server.once("listening", resolve));

const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}`;

after(() => {
  server.close();
});

test("root route keeps the server status response", async () => {
  const response = await fetch(`${baseUrl}/`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    message: "Server is running",
  });
});

test("health route reports the HTTP process status", async () => {
  const response = await fetch(`${baseUrl}/health`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    status: "ok",
  });
});

test("CORS allows a configured website origin", async () => {
  const response = await fetch(`${baseUrl}/health`, {
    headers: { Origin: "http://localhost:3000" },
  });

  assert.equal(
    response.headers.get("access-control-allow-origin"),
    "http://localhost:3000",
  );
});

test("CORS rejects an origin that is not configured", async () => {
  const response = await fetch(`${baseUrl}/health`, {
    headers: { Origin: "https://not-allowed.example" },
  });

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    success: false,
    message: "This website origin is not allowed",
  });
});

test("unknown routes return JSON 404 responses", async () => {
  const response = await fetch(`${baseUrl}/missing`);

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    success: false,
    message: "Route not found",
  });
});

test("malformed JSON returns a JSON 400 response", async () => {
  const response = await fetch(`${baseUrl}/health`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{invalid",
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    success: false,
    message: "Request body must contain valid JSON",
  });
});
