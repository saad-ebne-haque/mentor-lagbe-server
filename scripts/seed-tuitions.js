import "dotenv/config";
import { MongoClient } from "mongodb";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const databaseName = "mentor-lagbe";
const seedBatch = "assignment-approved-tuitions-v1";
const dayInMilliseconds = 24 * 60 * 60 * 1000;

export const seedListings = [
  {
    seedKey: "ssc-mathematics",
    title: "SSC Mathematics: Algebra and Geometry",
    subject: "Mathematics",
    classLevel: "Class 9-10",
    mode: "Offline",
    location: "Mirpur, Dhaka",
    monthlyFee: 6000,
    daysPerWeek: 4,
    description:
      "Build confidence in algebra, geometry, and exam-style problem solving with a structured weekly plan.",
  },
  {
    seedKey: "hsc-physics",
    title: "HSC Physics: Mechanics and Waves",
    subject: "Physics",
    classLevel: "Class 11-12",
    mode: "Online",
    location: "Online",
    monthlyFee: 7000,
    daysPerWeek: 3,
    description:
      "Review core mechanics and wave concepts, then practise applying formulas to HSC-level problems.",
  },
  {
    seedKey: "hsc-chemistry",
    title: "HSC Chemistry: Concepts and Numericals",
    subject: "Chemistry",
    classLevel: "Class 11-12",
    mode: "Offline",
    location: "Dhanmondi, Dhaka",
    monthlyFee: 7500,
    daysPerWeek: 3,
    description:
      "Study key chemistry concepts and work through numerical problems with regular progress checks.",
  },
  {
    seedKey: "class-6-8-english",
    title: "English Grammar and Writing Skills",
    subject: "English",
    classLevel: "Class 6-8",
    mode: "Online",
    location: "Online",
    monthlyFee: 4500,
    daysPerWeek: 3,
    description:
      "Practise grammar, reading comprehension, and clear paragraph writing in small weekly lessons.",
  },
  {
    seedKey: "primary-general",
    title: "Primary Mathematics and General Science",
    subject: "General Science",
    classLevel: "Class 3-5",
    mode: "Offline",
    location: "Uttara, Dhaka",
    monthlyFee: 5000,
    daysPerWeek: 4,
    description:
      "A steady foundation in primary mathematics and science, with lesson practice matched to classwork.",
  },
  {
    seedKey: "ssc-biology",
    title: "SSC Biology: Human Biology and Ecology",
    subject: "Biology",
    classLevel: "Class 9-10",
    mode: "Online",
    location: "Online",
    monthlyFee: 5500,
    daysPerWeek: 3,
    description:
      "Understand diagrams, important terms, and chapter questions through guided biology practice.",
  },
  {
    seedKey: "hsc-english",
    title: "HSC English: Reading and Composition",
    subject: "English",
    classLevel: "Class 11-12",
    mode: "Offline",
    location: "Chattogram",
    monthlyFee: 6000,
    daysPerWeek: 3,
    description:
      "Improve reading, grammar, and composition with focused practice for HSC coursework.",
  },
  {
    seedKey: "class-8-bangla",
    title: "Bangla Language and Literature",
    subject: "Bangla",
    classLevel: "Class 8",
    mode: "Online",
    location: "Online",
    monthlyFee: 4000,
    daysPerWeek: 2,
    description:
      "Review language fundamentals and literature lessons with short reading and writing exercises.",
  },
  {
    seedKey: "ssc-ict",
    title: "SSC ICT: Theory and Practical Basics",
    subject: "ICT",
    classLevel: "Class 9-10",
    mode: "Online",
    location: "Online",
    monthlyFee: 4500,
    daysPerWeek: 2,
    description:
      "Cover ICT concepts and practical basics using guided examples and topic-by-topic revision.",
  },
  {
    seedKey: "university-accounting",
    title: "University Accounting: Financial Accounting",
    subject: "Accounting",
    classLevel: "University",
    mode: "Offline",
    location: "Agrabad, Chattogram",
    monthlyFee: 8000,
    daysPerWeek: 3,
    description:
      "Work through core financial accounting topics and practise preparing clear, accurate solutions.",
  },
  {
    seedKey: "class-7-mathematics",
    title: "Class 7 Mathematics: Fractions and Geometry",
    subject: "Mathematics",
    classLevel: "Class 7",
    mode: "Offline",
    location: "Khilgaon, Dhaka",
    monthlyFee: 4500,
    daysPerWeek: 3,
    description:
      "Strengthen fraction, ratio, and geometry skills with examples aligned to the school syllabus.",
  },
  {
    seedKey: "hsc-economics",
    title: "HSC Economics: Microeconomics Foundations",
    subject: "Economics",
    classLevel: "Class 11-12",
    mode: "Online",
    location: "Online",
    monthlyFee: 6500,
    daysPerWeek: 3,
    description:
      "Learn foundational microeconomics concepts and practise applying them to structured questions.",
  },
  {
    seedKey: "hsc-mathematics",
    title: "HSC Mathematics: Functions and Calculus",
    subject: "Mathematics",
    classLevel: "Class 11-12",
    mode: "Online",
    location: "Online",
    monthlyFee: 7000,
    daysPerWeek: 3,
    description:
      "Review functions, trigonometry, and introductory calculus through guided examples and exam practice.",
  },
  {
    seedKey: "olevel-physics",
    title: "O Level Physics: Motion and Electricity",
    subject: "Physics",
    classLevel: "O Level",
    mode: "Offline",
    location: "Banani, Dhaka",
    monthlyFee: 8500,
    daysPerWeek: 3,
    description:
      "Strengthen core physics concepts with worked examples and regular O Level question practice.",
  },
  {
    seedKey: "class-5-all-subjects",
    title: "Class 5 Core Subjects Support",
    subject: "All Subjects",
    classLevel: "Class 5",
    mode: "Offline",
    location: "Nasirabad, Chattogram",
    monthlyFee: 5000,
    daysPerWeek: 5,
    description:
      "Support class 5 learning across core subjects with a weekly study routine and revision exercises.",
  },
  {
    seedKey: "class-8-general-science",
    title: "Class 8 General Science",
    subject: "General Science",
    classLevel: "Class 8",
    mode: "Online",
    location: "Online",
    monthlyFee: 4500,
    daysPerWeek: 3,
    description:
      "Connect science concepts to clear examples and practise explaining answers in complete steps.",
  },
  {
    seedKey: "ielts-writing-speaking",
    title: "IELTS Writing and Speaking Preparation",
    subject: "English",
    classLevel: "IELTS",
    mode: "Online",
    location: "Online",
    monthlyFee: 9000,
    daysPerWeek: 3,
    description:
      "Practise structured writing and speaking responses with feedback on clarity, organisation, and grammar.",
  },
  {
    seedKey: "university-statistics",
    title: "University Statistics: Probability Basics",
    subject: "Statistics",
    classLevel: "University",
    mode: "Online",
    location: "Online",
    monthlyFee: 8000,
    daysPerWeek: 2,
    description:
      "Build understanding of probability and introductory statistics with step-by-step problem practice.",
  },
  {
    seedKey: "ssc-chemistry",
    title: "SSC Chemistry: Periodic Table and Reactions",
    subject: "Chemistry",
    classLevel: "Class 9-10",
    mode: "Offline",
    location: "Wari, Dhaka",
    monthlyFee: 6000,
    daysPerWeek: 3,
    description:
      "Study periodic trends and common reactions with concise notes and syllabus-focused exercises.",
  },
  {
    seedKey: "class-6-english",
    title: "Class 6 English Reading and Grammar",
    subject: "English",
    classLevel: "Class 6",
    mode: "Online",
    location: "Online",
    monthlyFee: 4000,
    daysPerWeek: 2,
    description:
      "Develop reading comprehension and grammar skills through short, guided practice sessions.",
  },
];

export async function seedTuitions(db, tutorEmail, now = new Date()) {
  const tutor = await db
    .collection("user")
    .findOne({ email: tutorEmail, role: "tutor" });

  if (
    !tutor ||
    typeof tutor.name !== "string" ||
    !tutor.name.trim() ||
    typeof tutor.email !== "string" ||
    !tutor.email.trim()
  ) {
    throw new Error(
      `No usable Tutor account was found for ${tutorEmail}.`,
    );
  }

  const collection = db.collection("tuitions");
  const seedKeys = seedListings.map((listing) => listing.seedKey);
  const existingListings = await collection
    .find(
      { seedBatch, seedKey: { $in: seedKeys } },
      { projection: { seedKey: 1 } },
    )
    .toArray();
  const existingKeys = new Set(
    existingListings.map((listing) => listing.seedKey),
  );
  const newListings = seedListings
    .filter((listing) => !existingKeys.has(listing.seedKey))
    .map((listing, index) => {
      return {
        ...listing,
        tutorName: tutor.name.trim(),
        tutorEmail: tutor.email.trim(),
        approvalStatus: "approved",
        isActive: true,
        createdAt: new Date(now.getTime() - index * dayInMilliseconds),
        seedBatch,
      };
    });

  const existingTutorListingCount = await collection.countDocuments({
    tutorEmail: tutor.email,
  });
  if (
    newListings.length > 0 &&
    tutor.plan !== "pro" &&
    existingTutorListingCount + newListings.length > 2
  ) {
    throw new Error(
      "This Tutor is on the Free plan and cannot have more than two tuition listings.",
    );
  }

  if (newListings.length > 0) {
    await collection.insertMany(newListings);
  }

  return {
    insertedCount: newListings.length,
    skippedCount: seedListings.length - newListings.length,
  };
}

function getTutorEmailArgument() {
  const argumentIndex = process.argv.indexOf("--tutor-email");
  return argumentIndex === -1 ? undefined : process.argv[argumentIndex + 1];
}

async function main() {
  const tutorEmail = getTutorEmailArgument();
  if (!tutorEmail || !tutorEmail.includes("@")) {
    throw new Error(
      "Pass the existing Tutor email with --tutor-email <email>.",
    );
  }

  if (!process.argv.includes("--apply")) {
    console.log(
      `Dry run: ${seedListings.length} approved, active listings are configured for ${tutorEmail}. No database records were changed. Add -- --apply to insert missing listings.`,
    );
    return;
  }

  const uri = process.env.MONGODB_SECRET_URI;
  if (!uri) {
    throw new Error("MONGODB_SECRET_URI is required to seed tuition listings.");
  }

  const client = new MongoClient(uri);
  try {
    await client.connect();
    const result = await seedTuitions(client.db(databaseName), tutorEmail);
    console.log(
      `Inserted ${result.insertedCount} tuition listings for ${tutorEmail}; skipped ${result.skippedCount} existing seed listings.`,
    );
  } finally {
    await client.close();
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(`Tuition seeding failed: ${error.message}`);
    process.exitCode = 1;
  });
}
