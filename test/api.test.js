import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { after, beforeEach, test } from "node:test";
import { ObjectId } from "mongodb";
import { clientOrigin } from "../config.js";

const authUrl = clientOrigin;
process.env.STRIPE_SECRET_KEY = "test_stripe_secret";
process.env.STRIPE_WEBHOOK_SECRET = "test_webhook_secret";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const keyId = "0123456789abcdef01234567";
const publicJwk = publicKey.export({ format: "jwk" });
let db;
let stripeEvent;
let checkoutOptions;
let rejectStripeWebhook;

const fakeStripe = {
  checkout: {
    sessions: {
      async create(options) {
        checkoutOptions = options;
        return { id: "cs_test_1", url: "https://checkout.stripe.test/session" };
      },
    },
  },
  webhooks: {
    constructEvent() {
      if (rejectStripeWebhook) {
        throw new Error("Invalid signature");
      }
      return stripeEvent;
    },
  },
  subscriptions: {
    async retrieve() {
      return {
        metadata: { userId: "tutor-1", userRole: "tutor" },
      };
    },
  },
};

const { createApp } = await import("../app.js");
const app = createApp({
  getDb: async () => db,
  withTransaction: async (callback) => callback(db, undefined),
  stripeFactory: () => fakeStripe,
});
const server = app.listen(0);
await new Promise((resolve) => server.once("listening", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

beforeEach(() => {
  db.reset([
    {
      collection: "user",
      documents: [
        {
          id: "student-1",
          name: "Student One",
          email: "student@example.test",
          role: "student",
          plan: "free",
        },
        {
          id: "tutor-1",
          name: "Tutor One",
          email: "tutor@example.test",
          role: "tutor",
          plan: "free",
        },
        {
          id: "tutor-pro",
          name: "Pro Tutor",
          email: "pro-tutor@example.test",
          role: "tutor",
          plan: "pro",
        },
        {
          id: "admin-1",
          name: "Admin One",
          email: "admin@example.test",
          role: "admin",
          plan: "free",
        },
      ],
    },
    {
      collection: "jwks",
      documents: [{ id: keyId, publicKey: JSON.stringify(publicJwk) }],
    },
    { collection: "tuitions", documents: [] },
    { collection: "applications", documents: [] },
    { collection: "payments", documents: [] },
  ]);
  stripeEvent = undefined;
  checkoutOptions = undefined;
  rejectStripeWebhook = false;
});

after(() => {
  server.close();
});

function makeToken(userId) {
  const header = Buffer.from(
    JSON.stringify({ alg: "EdDSA", kid: keyId }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      sub: userId,
      iss: authUrl,
      aud: authUrl,
      exp: Math.floor(Date.now() / 1000) + 60,
    }),
  ).toString("base64url");
  const signingInput = `${header}.${payload}`;
  const signature = sign(null, Buffer.from(signingInput), privateKey).toString(
    "base64url",
  );

  return `${signingInput}.${signature}`;
}

function authHeaders(userId, extraHeaders = {}) {
  return {
    Authorization: `Bearer ${makeToken(userId)}`,
    ...extraHeaders,
  };
}

async function addTuition(overrides = {}) {
  const tuition = {
    _id: new ObjectId(),
    title: "Algebra tutoring",
    subject: "Mathematics",
    classLevel: "Class 9",
    mode: "Online",
    location: "Online",
    monthlyFee: 5000,
    daysPerWeek: 3,
    description: "Weekly algebra lessons.",
    bannerImage: "",
    tutorName: "Tutor One",
    tutorEmail: "tutor@example.test",
    approvalStatus: "approved",
    isActive: true,
    createdAt: new Date(),
    ...overrides,
  };
  db.collection("tuitions").documents.push(tuition);
  return tuition;
}

test("public tuition results include only approved active listings", async () => {
  await addTuition();
  await addTuition({ approvalStatus: "pending" });
  await addTuition({ isActive: false });

  const response = await fetch(`${baseUrl}/api/tuitions`);
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].approvalStatus, "approved");
});

test("public tuition details include a limited tutor profile", async () => {
  const tuition = await addTuition();

  const response = await fetch(
    `${baseUrl}/api/tuitions/${tuition._id.toString()}`,
  );
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.data.tutor.email, "tutor@example.test");
  assert.equal(result.data.tutor.password, undefined);
});

test("protected routes reject requests without a JWT", async () => {
  const response = await fetch(`${baseUrl}/api/dashboard/student`);

  assert.equal(response.status, 401);
  assert.match((await response.json()).message, /bearer token/i);
});

test("protected routes reject a tampered JWT", async () => {
  const [header, payload, signature] = makeToken("student-1").split(".");
  const replacement = signature[0] === "A" ? "B" : "A";
  const tamperedSignature = `${replacement}${signature.slice(1)}`;
  const response = await fetch(`${baseUrl}/api/dashboard/student`, {
    headers: {
      Authorization: `Bearer ${header}.${payload}.${tamperedSignature}`,
    },
  });

  assert.equal(response.status, 401);
});

test("JWT verification uses the current user role for access control", async () => {
  const response = await fetch(`${baseUrl}/api/dashboard/student`, {
    headers: authHeaders("tutor-1"),
  });

  assert.equal(response.status, 403);
});

test("JWT verification supports Better Auth MongoDB ObjectId records", async () => {
  const key = db.collection("jwks").documents[0];
  delete key.id;
  key._id = new ObjectId(keyId);

  const student = db
    .collection("user")
    .documents.find((user) => user.id === "student-1");
  delete student.id;
  student._id = new ObjectId();

  const dashboardResponse = await fetch(`${baseUrl}/api/dashboard/student`, {
    headers: authHeaders(student._id.toHexString()),
  });
  assert.equal(dashboardResponse.status, 200);

  const admin = db
    .collection("user")
    .documents.find((user) => user.id === "admin-1");
  delete admin.id;
  admin._id = new ObjectId();

  const roleResponse = await fetch(
    `${baseUrl}/api/admin/users/${admin._id.toHexString()}/role`,
    {
      method: "PATCH",
      headers: authHeaders(admin._id.toHexString(), {
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({ role: "student" }),
    },
  );
  assert.equal(roleResponse.status, 409);
});

test("students can apply once to an approved active tuition", async () => {
  const tuition = await addTuition();
  const request = () =>
    fetch(`${baseUrl}/api/applications`, {
      method: "POST",
      headers: authHeaders("student-1", {
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        tuitionId: tuition._id.toString(),
        studentPhone: "01700000000",
        preferredSchedule: "Weekend evenings",
      }),
    });

  const firstResponse = await request();
  const duplicateResponse = await request();

  assert.equal(firstResponse.status, 201);
  assert.equal(duplicateResponse.status, 409);
  assert.equal(db.collection("applications").documents.length, 1);
});

test("free tutors cannot create more than two tuition listings", async () => {
  await addTuition({ approvalStatus: "pending" });
  await addTuition({ approvalStatus: "rejected" });

  const response = await fetch(`${baseUrl}/api/tuitions`, {
    method: "POST",
    headers: authHeaders("tutor-1", {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({
      title: "New tuition",
      subject: "Physics",
      classLevel: "Class 10",
      mode: "Online",
      location: "Online",
      monthlyFee: 6000,
      daysPerWeek: 4,
      description: "Physics lessons.",
      bannerImage: "",
    }),
  });

  assert.equal(response.status, 403);
});

test("free tutors can create a pending listing within their post limit", async () => {
  const response = await fetch(`${baseUrl}/api/tuitions`, {
    method: "POST",
    headers: authHeaders("tutor-1", {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({
      title: "Physics tutoring",
      subject: "Physics",
      classLevel: "Class 10",
      mode: "Online",
      location: "Online",
      monthlyFee: 6000,
      daysPerWeek: 4,
      description: "Physics lessons.",
    }),
  });
  const result = await response.json();

  assert.equal(response.status, 201);
  assert.equal(result.data.approvalStatus, "pending");
  assert.equal(
    db.collection("user").documents.find((user) => user.id === "tutor-1")
      .freeTuitionsCount,
    1,
  );
});

test("admins can approve a pending tuition", async () => {
  const tuition = await addTuition({
    approvalStatus: "pending",
    isActive: true,
  });

  const response = await fetch(
    `${baseUrl}/api/admin/tuitions/${tuition._id}/status`,
    {
      method: "PATCH",
      headers: authHeaders("admin-1", {
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({ approvalStatus: "approved" }),
    },
  );

  assert.equal(response.status, 200);
  assert.equal(tuition.approvalStatus, "approved");
});

test("tutor checkout creates the monthly tutor price", async () => {
  const response = await fetch(`${baseUrl}/api/payments/checkout`, {
    method: "POST",
    headers: authHeaders("tutor-1", {
      "Content-Type": "application/json",
    }),
    body: "{}",
  });

  assert.equal(response.status, 201);
  assert.equal(checkoutOptions.mode, "subscription");
  assert.equal(checkoutOptions.line_items[0].price_data.unit_amount, 1500);
  assert.equal(
    checkoutOptions.line_items[0].price_data.recurring.interval,
    "month",
  );
  assert.equal(
    checkoutOptions.success_url,
    `${authUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
  );
  assert.equal(checkoutOptions.cancel_url, `${authUrl}/payment/cancel`);
});

test("student checkout uses the assigned monthly price", async () => {
  const response = await fetch(`${baseUrl}/api/payments/checkout`, {
    method: "POST",
    headers: authHeaders("student-1", {
      "Content-Type": "application/json",
    }),
    body: "{}",
  });

  assert.equal(response.status, 201);
  assert.equal(checkoutOptions.mode, "subscription");
  assert.equal(checkoutOptions.line_items[0].price_data.unit_amount, 1000);
});

test("Stripe webhook signature errors are rejected", async () => {
  rejectStripeWebhook = true;
  const response = await fetch(`${baseUrl}/api/payments/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "stripe-signature": "invalid-signature",
    },
    body: JSON.stringify({ fake: "raw event body" }),
  });

  assert.equal(response.status, 400);
});

test("paid subscription invoices update the existing user and record payment once", async () => {
  stripeEvent = {
    type: "invoice.paid",
    data: {
      object: {
        id: "in_test_webhook",
        subscription: "sub_test_1",
        amount_paid: 1500,
        currency: "usd",
        payment_intent: "pi_test_1",
        status_transitions: { paid_at: Math.floor(Date.now() / 1000) },
      },
    },
  };

  const sendWebhook = () =>
    fetch(`${baseUrl}/api/payments/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": "test-signature",
      },
      body: JSON.stringify({ fake: "raw event body" }),
    });
  const response = await sendWebhook();
  await sendWebhook();

  assert.equal(response.status, 200);
  assert.equal(
    db.collection("user").documents.find((user) => user.id === "tutor-1").plan,
    "pro",
  );
  assert.equal(db.collection("payments").documents.length, 1);
  assert.equal(db.collection("payments").documents[0].amount, 15);
  assert.equal(
    db.collection("payments").documents[0].transactionId,
    "pi_test_1",
  );
});

test("checkout completion upgrades only a paid monthly subscription", async () => {
  stripeEvent = {
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_checkout",
        mode: "subscription",
        payment_status: "paid",
        metadata: { userId: "student-1", userRole: "student" },
      },
    },
  };

  const response = await fetch(`${baseUrl}/api/payments/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "stripe-signature": "test-signature",
    },
    body: JSON.stringify({ fake: "raw event body" }),
  });

  assert.equal(response.status, 200);
  assert.equal(
    db.collection("user").documents.find((user) => user.id === "student-1")
      .plan,
    "pro",
  );
  assert.equal(db.collection("payments").documents.length, 0);
});

class MemoryDatabase {
  collections = new Map();

  collection(name) {
    if (!this.collections.has(name)) {
      this.collections.set(name, new MemoryCollection());
    }

    return this.collections.get(name);
  }

  reset(collections) {
    this.collections.clear();
    for (const { collection, documents } of collections) {
      this.collections.set(collection, new MemoryCollection(documents));
    }
  }
}

class MemoryCollection {
  constructor(documents = []) {
    this.documents = documents;
  }

  find(filter, options = {}) {
    const projection = options.projection;
    const documents = this.documents
      .filter((document) => matches(document, filter))
      .map((document) => {
        if (!projection) {
          return document;
        }

        return Object.fromEntries([
          ...(projection._id === 0 || document._id === undefined
            ? []
            : [["_id", document._id]]),
          ...Object.keys(projection)
            .filter(
              (field) =>
                field !== "_id" &&
                projection[field] &&
                document[field] !== undefined,
            )
            .map((field) => [field, document[field]]),
        ]);
      });

    return new MemoryCursor(documents);
  }

  async findOne(filter) {
    return this.documents.find((document) => matches(document, filter)) ?? null;
  }

  async insertOne(document) {
    if (
      this.documents.some(
        (existing) =>
          existing.tuitionId === document.tuitionId &&
          existing.studentEmail === document.studentEmail,
      )
    ) {
      const error = new Error("Duplicate application.");
      error.code = 11000;
      throw error;
    }

    const inserted = { ...document, _id: document._id ?? new ObjectId() };
    this.documents.push(inserted);
    return { insertedId: inserted._id };
  }

  async updateOne(filter, update, options = {}) {
    let document = this.documents.find((item) => matches(item, filter));
    if (!document && options.upsert) {
      document = { ...filter, ...(update.$setOnInsert ?? {}) };
      this.documents.push(document);
      return { matchedCount: 0, upsertedCount: 1 };
    }
    if (!document) {
      return { matchedCount: 0, upsertedCount: 0 };
    }

    Object.assign(document, update.$setOnInsert ?? {}, update.$set ?? {});
    return { matchedCount: 1, upsertedCount: 0 };
  }

  async deleteOne(filter) {
    const index = this.documents.findIndex((document) =>
      matches(document, filter),
    );
    if (index < 0) {
      return { deletedCount: 0 };
    }
    this.documents.splice(index, 1);
    return { deletedCount: 1 };
  }

  async countDocuments(filter) {
    return this.documents.filter((document) => matches(document, filter))
      .length;
  }

  async createIndex() {
    return "test_index";
  }

  aggregate(pipeline) {
    const total = this.documents.reduce(
      (sum, document) => sum + (document.amount ?? 0),
      0,
    );
    return new MemoryCursor(pipeline.length ? [{ _id: null, total }] : []);
  }
}

class MemoryCursor {
  constructor(documents) {
    this.documents = documents;
  }

  sort(order) {
    const [field, direction] = Object.entries(order)[0];
    this.documents.sort((left, right) => {
      const leftValue = left[field]?.getTime?.() ?? left[field];
      const rightValue = right[field]?.getTime?.() ?? right[field];
      return leftValue === rightValue
        ? 0
        : leftValue > rightValue
          ? direction
          : -direction;
    });
    return this;
  }

  async toArray() {
    return this.documents;
  }
}

function matches(document, filter = {}) {
  return Object.entries(filter).every(([field, expected]) => {
    if (field === "$or") {
      return expected.some((condition) => matches(document, condition));
    }
    if (field === "$and") {
      return expected.every((condition) => matches(document, condition));
    }

    const actual = document[field];
    if (
      expected &&
      typeof expected === "object" &&
      !(expected instanceof ObjectId)
    ) {
      if ("$exists" in expected) {
        return expected.$exists ? actual !== undefined : actual === undefined;
      }
      if ("$gt" in expected) {
        return actual > expected.$gt;
      }
    }

    if (actual instanceof ObjectId && expected instanceof ObjectId) {
      return actual.equals(expected);
    }

    return actual === expected;
  });
}

db = new MemoryDatabase();
