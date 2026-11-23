import "dotenv/config";
import { createPublicKey, verify } from "node:crypto";
import { ObjectId } from "mongodb";
import { clientOrigin } from "./config.js";
import { getDatabase } from "./db.js";

class AuthenticationError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.status = status;
  }
}

function decodeJsonPart(value) {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new AuthenticationError("Invalid bearer token.");
  }
}

function hasExpectedAudience(audience, expectedAudience) {
  return Array.isArray(audience)
    ? audience.includes(expectedAudience)
    : audience === expectedAudience;
}

function getIdFilter(id) {
  const filters = [{ id }, { _id: id }];
  if (ObjectId.isValid(id)) {
    filters.push({ _id: new ObjectId(id) });
  }
  return { $or: filters };
}

async function getAuthenticatedUser(token, db) {
  const tokenParts = token.split(".");

  if (tokenParts.length !== 3) {
    throw new AuthenticationError("Invalid bearer token.");
  }

  const [encodedHeader, encodedPayload, encodedSignature] = tokenParts;
  const header = decodeJsonPart(encodedHeader);
  const payload = decodeJsonPart(encodedPayload);

  if (
    !header ||
    typeof header !== "object" ||
    !payload ||
    typeof payload !== "object" ||
    header.alg !== "EdDSA" ||
    typeof header.kid !== "string" ||
    typeof payload.sub !== "string"
  ) {
    throw new AuthenticationError("Invalid bearer token.");
  }

  const now = Math.floor(Date.now() / 1000);
  if (
    typeof payload.exp !== "number" ||
    payload.exp <= now ||
    (typeof payload.nbf === "number" && payload.nbf > now) ||
    payload.iss !== clientOrigin ||
    !hasExpectedAudience(payload.aud, clientOrigin)
  ) {
    throw new AuthenticationError("Bearer token is expired or invalid.");
  }

  const keyRecord = await db.collection("jwks").findOne({
    $and: [
      getIdFilter(header.kid),
      {
        $or: [
          { expiresAt: { $exists: false } },
          { expiresAt: { $gt: new Date() } },
        ],
      },
    ],
  });

  if (!keyRecord) {
    throw new AuthenticationError("Bearer token signing key was not found.");
  }

  let publicKey;
  try {
    publicKey = createPublicKey({
      key: JSON.parse(keyRecord.publicKey),
      format: "jwk",
    });
  } catch {
    throw new Error("The stored Better Auth signing key is invalid.");
  }

  let isValid = false;
  try {
    isValid = verify(
      null,
      Buffer.from(`${encodedHeader}.${encodedPayload}`),
      publicKey,
      Buffer.from(encodedSignature, "base64url"),
    );
  } catch {
    throw new AuthenticationError("Bearer token signature is invalid.");
  }

  if (!isValid) {
    throw new AuthenticationError("Bearer token signature is invalid.");
  }

  const user = await db.collection("user").findOne(getIdFilter(payload.sub));
  if (!user || user.isActive === false) {
    throw new AuthenticationError("This account is unavailable.", 403);
  }

  if (!["student", "tutor", "admin"].includes(user.role)) {
    throw new AuthenticationError("This account has no valid role.", 403);
  }

  return {
    ...user,
    id: user.id ?? user._id?.toString(),
  };
}

export function createAuthenticationMiddleware(getDb = getDatabase) {
  return async (request, response, next) => {
    const authorization = request.get("authorization");
    const match = authorization?.match(/^Bearer\s+(.+)$/i);

    if (!match) {
      response.status(401).json({
        success: false,
        message: "A valid bearer token is required.",
      });
      return;
    }

    try {
      request.authUser = await getAuthenticatedUser(match[1], await getDb());
      next();
    } catch (error) {
      if (error instanceof AuthenticationError) {
        response.status(error.status).json({
          success: false,
          message: error.message,
        });
        return;
      }

      next(error);
    }
  };
}

export function createRoleMiddleware(role) {
  return (request, response, next) => {
    if (request.authUser?.role !== role) {
      response.status(403).json({
        success: false,
        message: `This action requires the ${role} role.`,
      });
      return;
    }

    next();
  };
}
