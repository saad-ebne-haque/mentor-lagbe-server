import assert from "node:assert/strict";
import { test } from "node:test";
import { seedListings, seedTuitions } from "../scripts/seed-tuitions.js";

function createDatabase({ tutors, tuitions = [] }) {
  const collections = { user: tutors, tuitions };

  return {
    collection(name) {
      return {
        find(filter) {
          return {
            async toArray() {
              return collections[name].filter((document) => {
                if (filter.role && document.role !== filter.role) {
                  return false;
                }

                if (
                  filter.seedBatch &&
                  document.seedBatch !== filter.seedBatch
                ) {
                  return false;
                }

                if (
                  filter.seedKey?.$in &&
                  !filter.seedKey.$in.includes(document.seedKey)
                ) {
                  return false;
                }

                return true;
              });
            },
          };
        },
        async findOne(filter) {
          return (
            collections[name].find(
              (document) =>
                document.email === filter.email &&
                document.role === filter.role,
            ) ?? null
          );
        },
        async countDocuments(filter) {
          return collections[name].filter((document) =>
            Object.entries(filter).every(([key, value]) => {
              return document[key] === value;
            }),
          ).length;
        },
        async insertMany(documents) {
          collections[name].push(...documents);
          return { insertedCount: documents.length };
        },
      };
    },
    documents(name) {
      return collections[name];
    },
  };
}

test("seeds 20 approved active listings for the selected Tutor", async () => {
  const db = createDatabase({
    tutors: [
      {
        name: "Tutor One",
        email: "tutor-one@example.test",
        role: "tutor",
        plan: "pro",
      },
    ],
  });

  const result = await seedTuitions(
    db,
    "tutor-one@example.test",
    new Date("2026-01-01T00:00:00.000Z"),
  );
  const listings = db.documents("tuitions");

  assert.equal(result.insertedCount, 20);
  assert.equal(result.skippedCount, 0);
  assert.equal(listings.length, 20);
  assert.ok(
    listings.every(
      (listing) =>
        listing.approvalStatus === "approved" &&
        listing.isActive === true &&
        listing.tutorEmail === "tutor-one@example.test",
    ),
  );
  assert.equal(new Set(listings.map((listing) => listing.seedKey)).size, 20);
});

test("does not overwrite existing seed listings or insert duplicates", async () => {
  const existingListing = {
    seedBatch: "assignment-approved-tuitions-v1",
    seedKey: seedListings[0].seedKey,
    title: "Existing edited sample",
  };
  const db = createDatabase({
    tutors: [
      {
        name: "Tutor One",
        email: "tutor@example.test",
        role: "tutor",
        plan: "pro",
      },
    ],
    tuitions: [existingListing],
  });

  const result = await seedTuitions(db, "tutor@example.test");
  const secondResult = await seedTuitions(db, "tutor@example.test");

  assert.equal(result.insertedCount, 19);
  assert.equal(secondResult.insertedCount, 0);
  assert.equal(db.documents("tuitions").length, 20);
  assert.equal(db.documents("tuitions")[0].title, "Existing edited sample");
});

test("stops without changing data when the selected Tutor is missing", async () => {
  const db = createDatabase({ tutors: [] });

  await assert.rejects(
    seedTuitions(db, "missing@example.test"),
    /No usable Tutor account was found/,
  );
  assert.equal(db.documents("tuitions").length, 0);
});

test("enforces the Free Tutor listing limit before inserting", async () => {
  const db = createDatabase({
    tutors: [
      { name: "Free Tutor", email: "free@example.test", role: "tutor" },
    ],
  });

  await assert.rejects(
    seedTuitions(db, "free@example.test"),
    /Free plan and cannot have more than two/,
  );
  assert.equal(db.documents("tuitions").length, 0);
});
