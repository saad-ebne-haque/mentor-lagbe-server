import "dotenv/config";
import { MongoClient } from "mongodb";

const databaseName = "mentor-lagbe";
const globalForMongo = globalThis;

export async function getDatabase() {
  const uri = process.env.MONGODB_SECRET_URI;

  if (!uri) {
    throw new Error("MONGODB_SECRET_URI is required to connect to MongoDB.");
  }

  if (!globalForMongo.mentorLagbeDatabasePromise) {
    const client =
      globalForMongo.mentorLagbeMongoClient ?? new MongoClient(uri);
    globalForMongo.mentorLagbeMongoClient = client;
    globalForMongo.mentorLagbeDatabasePromise = client
      .connect()
      .then(async () => {
        const db = client.db(databaseName);

        await db.collection("applications").createIndex(
          { tuitionId: 1, studentEmail: 1 },
          {
            unique: true,
            name: "one_application_per_student_per_tuition",
          },
        );
        await db.collection("payments").createIndex(
          { stripeInvoiceId: 1 },
          {
            unique: true,
            partialFilterExpression: { stripeInvoiceId: { $type: "string" } },
            name: "one_payment_per_stripe_invoice",
          },
        );

        return db;
      })
      .catch((error) => {
        delete globalForMongo.mentorLagbeDatabasePromise;
        delete globalForMongo.mentorLagbeMongoClient;
        throw error;
      });
  }

  return globalForMongo.mentorLagbeDatabasePromise;
}

export async function withDatabaseTransaction(callback) {
  const db = await getDatabase();
  const session = globalForMongo.mentorLagbeMongoClient.startSession();

  try {
    return await session.withTransaction(() => callback(db, session));
  } finally {
    await session.endSession();
  }
}
