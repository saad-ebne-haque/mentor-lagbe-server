import "dotenv/config";
import { Router } from "express";
import { ObjectId } from "mongodb";
import Stripe from "stripe";
import {
  createAuthenticationMiddleware,
  createRoleMiddleware,
} from "../auth.js";
import { clientOrigin } from "../config.js";
import { getDatabase, withDatabaseTransaction } from "../db.js";

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function getBody(request) {
  if (
    !request.body ||
    typeof request.body !== "object" ||
    Array.isArray(request.body)
  ) {
    throw new ApiError(400, "A JSON request body is required.");
  }

  return request.body;
}

function requiredText(body, field, maximumLength = 200) {
  const value = body[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(400, `${field} is required.`);
  }

  const trimmedValue = value.trim();
  if (trimmedValue.length > maximumLength) {
    throw new ApiError(
      400,
      `${field} must be ${maximumLength} characters or fewer.`,
    );
  }

  return trimmedValue;
}

function optionalText(body, field, maximumLength = 200) {
  if (body[field] === undefined) {
    return undefined;
  }

  if (typeof body[field] !== "string") {
    throw new ApiError(400, `${field} must be text.`);
  }

  const value = body[field].trim();
  if (value.length > maximumLength) {
    throw new ApiError(
      400,
      `${field} must be ${maximumLength} characters or fewer.`,
    );
  }

  return value;
}

function getTuitionFields(body, partial = false) {
  const fields = {};
  const textFields = [
    ["title", 120],
    ["subject", 80],
    ["classLevel", 80],
    ["location", 160],
    ["description", 3000],
    ["bannerImage", 1000],
  ];

  for (const [field, maximumLength] of textFields) {
    const value =
      field === "bannerImage" || partial
        ? optionalText(body, field, maximumLength)
        : requiredText(body, field, maximumLength);

    if (value !== undefined) {
      fields[field] = value;
    }
  }

  if (!partial && fields.bannerImage === undefined) {
    fields.bannerImage = "";
  }
  if (body.mode !== undefined || !partial) {
    if (!["Online", "Offline"].includes(body.mode)) {
      throw new ApiError(400, "mode must be Online or Offline.");
    }
    fields.mode = body.mode;
  }

  if (body.monthlyFee !== undefined || !partial) {
    const monthlyFee = Number(body.monthlyFee);
    if (!Number.isFinite(monthlyFee) || monthlyFee <= 0) {
      throw new ApiError(400, "monthlyFee must be a positive number.");
    }
    fields.monthlyFee = monthlyFee;
  }

  if (body.daysPerWeek !== undefined || !partial) {
    const daysPerWeek = Number(body.daysPerWeek);
    if (!Number.isInteger(daysPerWeek) || daysPerWeek < 1 || daysPerWeek > 7) {
      throw new ApiError(400, "daysPerWeek must be a number from 1 to 7.");
    }
    fields.daysPerWeek = daysPerWeek;
  }

  if (fields.bannerImage) {
    let imageUrl;
    try {
      imageUrl = new URL(fields.bannerImage);
    } catch {
      throw new ApiError(400, "bannerImage must be a valid HTTP or HTTPS URL.");
    }

    if (imageUrl.protocol !== "http:" && imageUrl.protocol !== "https:") {
      throw new ApiError(400, "bannerImage must be a valid HTTP or HTTPS URL.");
    }
  }

  if (partial && Object.keys(fields).length === 0) {
    throw new ApiError(400, "Provide at least one tuition field to update.");
  }

  return fields;
}

function getObjectId(value, label) {
  if (typeof value !== "string" || !ObjectId.isValid(value)) {
    throw new ApiError(400, `${label} is invalid.`);
  }

  return new ObjectId(value);
}

function getStripeClient(factory) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new ApiError(503, "Stripe payments are not configured.");
  }

  return factory(secretKey);
}

function getPlanName(role) {
  return role === "tutor"
    ? "MentorLagbe Pro for Tutors"
    : "MentorLagbe Pro for Students";
}

async function activateProPlan(db, checkoutSession) {
  if (
    checkoutSession.mode !== "subscription" ||
    checkoutSession.payment_status !== "paid"
  ) {
    return;
  }

  const userId = checkoutSession.metadata?.userId;
  if (typeof userId !== "string") {
    throw new ApiError(400, "The completed checkout has no user reference.");
  }

  const user = await db.collection("user").findOne({ id: userId });
  if (
    !user ||
    !["student", "tutor"].includes(checkoutSession.metadata?.userRole)
  ) {
    throw new ApiError(
      400,
      "The completed checkout does not match an account.",
    );
  }

  await db
    .collection("user")
    .updateOne({ id: user.id }, { $set: { plan: "pro" } });
}

function getSubscriptionId(invoice) {
  const subscription =
    invoice.subscription ?? invoice.parent?.subscription_details?.subscription;

  return typeof subscription === "string" ? subscription : subscription?.id;
}

async function savePaidInvoice(db, stripe, invoice) {
  const subscriptionId = getSubscriptionId(invoice);
  if (
    !subscriptionId ||
    typeof invoice.id !== "string" ||
    !Number.isFinite(invoice.amount_paid)
  ) {
    throw new ApiError(400, "The paid invoice has no subscription reference.");
  }

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const userId = subscription.metadata?.userId;
  const userRole = subscription.metadata?.userRole;
  if (typeof userId !== "string") {
    throw new ApiError(400, "The subscription has no user reference.");
  }

  const user = await db.collection("user").findOne({ id: userId });
  if (!user || !["student", "tutor"].includes(userRole)) {
    throw new ApiError(400, "The subscription does not match an account.");
  }

  const paymentIntent =
    typeof invoice.payment_intent === "string"
      ? invoice.payment_intent
      : invoice.payment_intent?.id;
  const paidAt = invoice.status_transitions?.paid_at;

  await db.collection("payments").updateOne(
    { stripeInvoiceId: invoice.id },
    {
      $setOnInsert: {
        userEmail: user.email,
        userName: user.name,
        userRole,
        planName: "Pro",
        amount: invoice.amount_paid / 100,
        currency: invoice.currency ?? "usd",
        transactionId: paymentIntent ?? invoice.id,
        stripeSessionId: null,
        stripeInvoiceId: invoice.id,
        paymentStatus: "paid",
        paidAt:
          typeof paidAt === "number" ? new Date(paidAt * 1000) : new Date(),
      },
    },
    { upsert: true },
  );

  await db
    .collection("user")
    .updateOne({ id: user.id }, { $set: { plan: "pro" } });
}

export function createApiRouter({
  getDb = getDatabase,
  withTransaction = withDatabaseTransaction,
  stripeFactory = (secretKey) => new Stripe(secretKey),
} = {}) {
  const router = Router();
  const authenticate = createAuthenticationMiddleware(getDb);
  const requireStudent = createRoleMiddleware("student");
  const requireTutor = createRoleMiddleware("tutor");
  const requireAdmin = createRoleMiddleware("admin");

  router.get("/tuitions", async (request, response) => {
    const db = await getDb();
    const tuitions = await db
      .collection("tuitions")
      .find({ approvalStatus: "approved", isActive: true })
      .sort({ createdAt: -1 })
      .toArray();

    response.json({ success: true, data: tuitions });
  });

  router.get("/tuitions/:tuitionId", async (request, response) => {
    const tuitionId = getObjectId(request.params.tuitionId, "tuitionId");
    const db = await getDb();
    const tuition = await db.collection("tuitions").findOne({
      _id: tuitionId,
      approvalStatus: "approved",
      isActive: true,
    });

    if (!tuition) {
      throw new ApiError(404, "Tuition was not found.");
    }

    const tutor = await db.collection("user").findOne(
      { email: tuition.tutorEmail },
      {
        projection: {
          id: 1,
          name: 1,
          email: 1,
          image: 1,
          bio: 1,
        },
      },
    );

    response.json({
      success: true,
      data: {
        ...tuition,
        tutor: tutor
          ? {
              id: tutor.id,
              name: tutor.name,
              email: tutor.email,
              image: tutor.image ?? null,
              bio: tutor.bio ?? "",
            }
          : null,
      },
    });
  });

  router.get(
    "/dashboard/student",
    authenticate,
    requireStudent,
    async (request, response) => {
      const db = await getDb();
      const filter = { studentEmail: request.authUser.email };
      const applications = db.collection("applications");
      const [total, accepted, pending] = await Promise.all([
        applications.countDocuments(filter),
        applications.countDocuments({ ...filter, status: "accepted" }),
        applications.countDocuments({ ...filter, status: "pending" }),
      ]);

      response.json({
        success: true,
        data: {
          totalApplications: total,
          acceptedApplications: accepted,
          pendingApplications: pending,
          plan: request.authUser.plan ?? "free",
        },
      });
    },
  );

  router.get(
    "/dashboard/tutor",
    authenticate,
    requireTutor,
    async (request, response) => {
      const db = await getDb();
      const tuitionFilter = { tutorEmail: request.authUser.email };
      const tuitions = await db
        .collection("tuitions")
        .find(tuitionFilter)
        .toArray();
      const totalApplicants = await db
        .collection("applications")
        .countDocuments({ tutorEmail: request.authUser.email });

      response.json({
        success: true,
        data: {
          totalTuitions: tuitions.length,
          activeApprovedTuitions: tuitions.filter(
            (tuition) =>
              tuition.isActive && tuition.approvalStatus === "approved",
          ).length,
          totalApplicants,
          plan: request.authUser.plan ?? "free",
        },
      });
    },
  );

  router.get(
    "/dashboard/admin",
    authenticate,
    requireAdmin,
    async (request, response) => {
      const db = await getDb();
      const users = db.collection("user");
      const tuitions = db.collection("tuitions");
      const payments = db.collection("payments");
      const [
        totalUsers,
        totalTutors,
        pendingTuitions,
        approvedTuitions,
        revenueRows,
      ] = await Promise.all([
        users.countDocuments({}),
        users.countDocuments({ role: "tutor" }),
        tuitions.countDocuments({ approvalStatus: "pending" }),
        tuitions.countDocuments({ approvalStatus: "approved" }),
        payments
          .aggregate([{ $group: { _id: null, total: { $sum: "$amount" } } }])
          .toArray(),
      ]);

      response.json({
        success: true,
        data: {
          totalUsers,
          totalTutors,
          pendingTuitions,
          approvedTuitions,
          totalRevenue: revenueRows[0]?.total ?? 0,
        },
      });
    },
  );

  router.get(
    "/tutor/tuitions",
    authenticate,
    requireTutor,
    async (request, response) => {
      const tuitions = await (
        await getDb()
      )
        .collection("tuitions")
        .find({ tutorEmail: request.authUser.email })
        .sort({ createdAt: -1 })
        .toArray();

      response.json({ success: true, data: tuitions });
    },
  );

  router.post(
    "/tuitions",
    authenticate,
    requireTutor,
    async (request, response) => {
      const fields = getTuitionFields(getBody(request));
      const plan = request.authUser.plan ?? "free";
      const tuition = {
        ...fields,
        tutorName: request.authUser.name,
        tutorEmail: request.authUser.email,
        approvalStatus: "pending",
        isActive: true,
        createdAt: new Date(),
      };
      const result = await withTransaction(async (db, session) => {
        const collection = db.collection("tuitions");
        const users = db.collection("user");
        const count = await collection.countDocuments(
          { tutorEmail: request.authUser.email },
          { session },
        );

        if (plan !== "pro" && count >= 2) {
          throw new ApiError(403, "Free tutors can post up to two tuitions.");
        }

        if (plan !== "pro") {
          const user = await users.findOne(
            { id: request.authUser.id },
            { session },
          );
          if (!user) {
            throw new ApiError(403, "Tutor account was not found.");
          }

          const userFilter = { id: user.id };
          if (user.freeTuitionsCount === undefined) {
            userFilter.freeTuitionsCount = { $exists: false };
          } else {
            userFilter.freeTuitionsCount = user.freeTuitionsCount;
          }

          const counterResult = await users.updateOne(
            userFilter,
            { $set: { freeTuitionsCount: count + 1 } },
            { session },
          );
          if (counterResult.matchedCount === 0) {
            throw new ApiError(409, "Retry creating this tuition.");
          }
        }

        return collection.insertOne(tuition, { session });
      });

      response.status(201).json({
        success: true,
        data: { ...tuition, _id: result.insertedId },
      });
    },
  );

  router.patch(
    "/tuitions/:tuitionId",
    authenticate,
    requireTutor,
    async (request, response) => {
      const tuitionId = getObjectId(request.params.tuitionId, "tuitionId");
      const db = await getDb();
      const collection = db.collection("tuitions");
      const tuition = await collection.findOne({
        _id: tuitionId,
        tutorEmail: request.authUser.email,
      });

      if (!tuition) {
        throw new ApiError(404, "Tuition was not found.");
      }

      const fields = getTuitionFields(getBody(request), true);
      if (tuition.approvalStatus === "approved") {
        fields.approvalStatus = "pending";
      }

      await collection.updateOne({ _id: tuitionId }, { $set: fields });
      response.json({
        success: true,
        data: { ...tuition, ...fields },
      });
    },
  );

  router.patch(
    "/tuitions/:tuitionId/active",
    authenticate,
    requireTutor,
    async (request, response) => {
      const tuitionId = getObjectId(request.params.tuitionId, "tuitionId");
      const body = getBody(request);
      if (typeof body.isActive !== "boolean") {
        throw new ApiError(400, "isActive must be true or false.");
      }

      const collection = (await getDb()).collection("tuitions");
      const tuition = await collection.findOne({
        _id: tuitionId,
        tutorEmail: request.authUser.email,
      });

      if (!tuition) {
        throw new ApiError(404, "Tuition was not found.");
      }
      if (body.isActive && tuition.approvalStatus !== "approved") {
        throw new ApiError(409, "Only approved tuitions can be activated.");
      }

      await collection.updateOne(
        { _id: tuitionId },
        { $set: { isActive: body.isActive } },
      );
      response.json({
        success: true,
        data: { ...tuition, isActive: body.isActive },
      });
    },
  );

  router.delete(
    "/tuitions/:tuitionId",
    authenticate,
    requireTutor,
    async (request, response) => {
      const tuitionId = getObjectId(request.params.tuitionId, "tuitionId");
      const result = await (await getDb()).collection("tuitions").deleteOne({
        _id: tuitionId,
        tutorEmail: request.authUser.email,
      });

      if (result.deletedCount === 0) {
        throw new ApiError(404, "Tuition was not found.");
      }

      response.json({ success: true, message: "Tuition deleted." });
    },
  );

  router.get(
    "/applications/me",
    authenticate,
    requireStudent,
    async (request, response) => {
      const db = await getDb();
      const applications = await db
        .collection("applications")
        .find({ studentEmail: request.authUser.email })
        .sort({ appliedAt: -1 })
        .toArray();
      const applicationsWithTutorNames = await Promise.all(
        applications.map(async (application) => {
          if (
            typeof application.tutorName === "string" &&
            application.tutorName.trim()
          ) {
            return application;
          }

          const tutor = await db.collection("user").findOne({
            email: application.tutorEmail,
          });

          return {
            ...application,
            tutorName: typeof tutor?.name === "string" ? tutor.name : null,
          };
        }),
      );

      response.json({ success: true, data: applicationsWithTutorNames });
    },
  );

  router.post(
    "/applications",
    authenticate,
    requireStudent,
    async (request, response) => {
      const body = getBody(request);
      const tuitionId = getObjectId(body.tuitionId, "tuitionId");
      const db = await getDb();
      const tuition = await db.collection("tuitions").findOne({
        _id: tuitionId,
        approvalStatus: "approved",
        isActive: true,
      });

      if (!tuition) {
        throw new ApiError(404, "Approved active tuition was not found.");
      }

      const application = {
        tuitionId: tuition._id.toString(),
        tuitionTitle: tuition.title,
        subject: tuition.subject,
        monthlyFee: tuition.monthlyFee,
        tutorName: tuition.tutorName ?? null,
        tutorEmail: tuition.tutorEmail,
        studentName: request.authUser.name,
        studentEmail: request.authUser.email,
        studentPhone: requiredText(body, "studentPhone", 40),
        preferredSchedule: requiredText(body, "preferredSchedule", 500),
        studentNote: optionalText(body, "studentNote", 1000) ?? "",
        status: "pending",
        appliedAt: new Date(),
      };

      try {
        const result = await db
          .collection("applications")
          .insertOne(application);
        response.status(201).json({
          success: true,
          data: { ...application, _id: result.insertedId },
        });
      } catch (error) {
        if (error.code === 11000) {
          throw new ApiError(409, "You have already applied for this tuition.");
        }
        throw error;
      }
    },
  );

  router.delete(
    "/applications/:applicationId",
    authenticate,
    requireStudent,
    async (request, response) => {
      const applicationId = getObjectId(
        request.params.applicationId,
        "applicationId",
      );
      const collection = (await getDb()).collection("applications");
      const application = await collection.findOne({
        _id: applicationId,
        studentEmail: request.authUser.email,
      });

      if (!application) {
        throw new ApiError(404, "Application was not found.");
      }
      if (application.status !== "pending") {
        throw new ApiError(409, "Only pending applications can be cancelled.");
      }

      await collection.deleteOne({ _id: applicationId });
      response.json({ success: true, message: "Application cancelled." });
    },
  );

  router.get(
    "/tutor/applications",
    authenticate,
    requireTutor,
    async (request, response) => {
      const applications = await (
        await getDb()
      )
        .collection("applications")
        .find({ tutorEmail: request.authUser.email })
        .sort({ appliedAt: -1 })
        .toArray();

      response.json({ success: true, data: applications });
    },
  );

  router.patch(
    "/applications/:applicationId/status",
    authenticate,
    requireTutor,
    async (request, response) => {
      const applicationId = getObjectId(
        request.params.applicationId,
        "applicationId",
      );
      const status = getBody(request).status;
      if (!["accepted", "rejected"].includes(status)) {
        throw new ApiError(400, "status must be accepted or rejected.");
      }

      const db = await getDb();
      const collection = db.collection("applications");
      const application = await collection.findOne({
        _id: applicationId,
        tutorEmail: request.authUser.email,
      });

      if (!application) {
        throw new ApiError(404, "Application was not found.");
      }
      if (application.status !== "pending") {
        throw new ApiError(409, "Only pending applications can be decided.");
      }

      const tuition = await db.collection("tuitions").findOne({
        _id: getObjectId(application.tuitionId, "tuitionId"),
        tutorEmail: request.authUser.email,
      });
      if (!tuition) {
        throw new ApiError(404, "The related tuition was not found.");
      }

      await collection.updateOne({ _id: applicationId }, { $set: { status } });
      response.json({
        success: true,
        data: { ...application, status },
      });
    },
  );

  router.get(
    "/admin/users",
    authenticate,
    requireAdmin,
    async (request, response) => {
      const users = await (
        await getDb()
      )
        .collection("user")
        .find(
          {},
          {
            projection: {
              id: 1,
              name: 1,
              email: 1,
              image: 1,
              role: 1,
              plan: 1,
              createdAt: 1,
            },
          },
        )
        .sort({ createdAt: -1 })
        .toArray();

      response.json({ success: true, data: users });
    },
  );

  router.patch(
    "/admin/users/:userId/role",
    authenticate,
    requireAdmin,
    async (request, response) => {
      const userId = requiredText(request.params, "userId", 200);
      const role = getBody(request).role;
      if (!["student", "tutor", "admin"].includes(role)) {
        throw new ApiError(400, "role must be student, tutor, or admin.");
      }
      if (userId === request.authUser.id) {
        throw new ApiError(409, "Admins cannot change their own role.");
      }

      const result = await (
        await getDb()
      )
        .collection("user")
        .updateOne({ id: userId }, { $set: { role } });
      if (result.matchedCount === 0) {
        throw new ApiError(404, "User was not found.");
      }

      response.json({ success: true, data: { id: userId, role } });
    },
  );

  router.get(
    "/admin/tuitions",
    authenticate,
    requireAdmin,
    async (request, response) => {
      const tuitions = await (
        await getDb()
      )
        .collection("tuitions")
        .find({})
        .sort({ createdAt: -1 })
        .toArray();

      response.json({ success: true, data: tuitions });
    },
  );

  router.patch(
    "/admin/tuitions/:tuitionId/status",
    authenticate,
    requireAdmin,
    async (request, response) => {
      const tuitionId = getObjectId(request.params.tuitionId, "tuitionId");
      const approvalStatus = getBody(request).approvalStatus;
      if (!["approved", "rejected"].includes(approvalStatus)) {
        throw new ApiError(400, "approvalStatus must be approved or rejected.");
      }

      const collection = (await getDb()).collection("tuitions");
      const result = await collection.updateOne(
        { _id: tuitionId },
        { $set: { approvalStatus } },
      );
      if (result.matchedCount === 0) {
        throw new ApiError(404, "Tuition was not found.");
      }

      response.json({ success: true, data: { approvalStatus } });
    },
  );

  router.get(
    "/admin/payments",
    authenticate,
    requireAdmin,
    async (request, response) => {
      const payments = await (
        await getDb()
      )
        .collection("payments")
        .find({})
        .sort({ paidAt: -1 })
        .toArray();

      response.json({ success: true, data: payments });
    },
  );

  router.post("/payments/checkout", authenticate, async (request, response) => {
    if (!["student", "tutor"].includes(request.authUser.role)) {
      throw new ApiError(403, "Only students and tutors can upgrade.");
    }
    if (request.authUser.plan === "pro") {
      throw new ApiError(409, "This account already has the Pro plan.");
    }

    const stripe = getStripeClient(stripeFactory);
    const amount = request.authUser.role === "tutor" ? 1500 : 1000;
    const planName = getPlanName(request.authUser.role);
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: request.authUser.email,
      client_reference_id: request.authUser.id,
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: amount,
            recurring: { interval: "month" },
            product_data: { name: planName },
          },
          quantity: 1,
        },
      ],
      metadata: {
        userId: request.authUser.id,
        userRole: request.authUser.role,
        planName: "Pro",
      },
      subscription_data: {
        metadata: {
          userId: request.authUser.id,
          userRole: request.authUser.role,
          planName: "Pro",
        },
      },
      success_url: `${clientOrigin}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${clientOrigin}/payment/cancel`,
    });

    response.status(201).json({
      success: true,
      data: { sessionId: session.id, url: session.url },
    });
  });

  router.post("/payments/webhook", async (request, response) => {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      throw new ApiError(503, "Stripe webhook verification is not configured.");
    }
    if (!Buffer.isBuffer(request.body)) {
      throw new ApiError(400, "The Stripe webhook body must be raw JSON.");
    }

    const signature = request.get("stripe-signature");
    if (!signature) {
      throw new ApiError(400, "Stripe signature header is required.");
    }

    const stripe = getStripeClient(stripeFactory);
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        request.body,
        signature,
        webhookSecret,
      );
    } catch {
      throw new ApiError(400, "Stripe webhook signature is invalid.");
    }

    if (event.type === "checkout.session.completed") {
      await activateProPlan(await getDb(), event.data.object);
    } else if (event.type === "invoice.paid") {
      await savePaidInvoice(await getDb(), stripe, event.data.object);
    }

    response.json({ received: true });
  });

  return router;
}
