import "dotenv/config";
import cors from "cors";
import express from "express";
import { createApiRouter } from "./routes/api.js";

const developmentOrigins = ["http://localhost:3000", "http://127.0.0.1:3000"];

function getAllowedOrigins() {
  const configuredOrigins = process.env.CORS_ORIGINS;
  const origins =
    configuredOrigins === undefined
      ? process.env.NODE_ENV === "production"
        ? []
        : developmentOrigins
      : configuredOrigins.split(",").map((origin) => origin.trim());

  if (origins.length === 0 || origins.some((origin) => !origin)) {
    throw new Error(
      "Set CORS_ORIGINS to a comma-separated list of allowed website origins.",
    );
  }

  return new Set(
    origins.map((origin) => {
      let parsedOrigin;

      try {
        parsedOrigin = new URL(origin);
      } catch {
        throw new Error(`Invalid origin in CORS_ORIGINS: ${origin}`);
      }

      if (
        (parsedOrigin.protocol !== "http:" &&
          parsedOrigin.protocol !== "https:") ||
        parsedOrigin.origin !== origin
      ) {
        throw new Error(
          `CORS_ORIGINS entries must be origins without paths: ${origin}`,
        );
      }

      return parsedOrigin.origin;
    }),
  );
}

export function createApp(apiOptions) {
  const allowedOrigins = getAllowedOrigins();
  const app = express();

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || allowedOrigins.has(origin)) {
          callback(null, true);
          return;
        }

        callback(new Error("CORS_ORIGIN_DENIED"));
      },
      credentials: true,
    }),
  );

  app.get("/", (request, response) => {
    response.json({
      success: true,
      message: "Server is running",
    });
  });

  app.get("/health", (request, response) => {
    response.json({
      success: true,
      status: "ok",
    });
  });

  app.use(
    "/api/payments/webhook",
    express.raw({ type: "application/json", limit: "1mb" }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use("/api", createApiRouter(apiOptions));

  app.use((request, response) => {
    response.status(404).json({
      success: false,
      message: "Route not found",
    });
  });

  app.use((error, request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }

    if (error.message === "CORS_ORIGIN_DENIED") {
      response.status(403).json({
        success: false,
        message: "This website origin is not allowed",
      });
      return;
    }

    if (error.type === "entity.parse.failed") {
      response.status(400).json({
        success: false,
        message: "Request body must contain valid JSON",
      });
      return;
    }

    if (error.type === "entity.too.large") {
      response.status(413).json({
        success: false,
        message: "Request body is too large.",
      });
      return;
    }

    if (
      Number.isInteger(error.status) &&
      error.status >= 400 &&
      error.status < 500
    ) {
      response.status(error.status).json({
        success: false,
        message: error.message,
      });
      return;
    }

    console.error("Unhandled API error:", error);
    response.status(500).json({
      success: false,
      message: "Internal server error",
    });
  });

  return app;
}

export default createApp();
