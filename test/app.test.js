import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  clientOrigin,
  getAllowedOrigins,
  getClientOrigin,
} from "../config.js";

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

test("CORS allows the frontend origin for this environment", async () => {
  const response = await fetch(`${baseUrl}/health`, {
    headers: { Origin: clientOrigin },
  });

  assert.equal(
    response.headers.get("access-control-allow-origin"),
    clientOrigin,
  );
});

test("production uses the hardcoded frontend origin", () => {
  assert.equal(
    getClientOrigin("production"),
    "https://mentor-lagbe-one.vercel.app",
  );
  assert.deepEqual(getAllowedOrigins("production"), [
    "https://mentor-lagbe-one.vercel.app",
  ]);
});

test("development uses hardcoded localhost frontend origins", () => {
  assert.equal(getClientOrigin("development"), "http://localhost:3000");
  assert.deepEqual(getAllowedOrigins("development"), [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ]);
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
