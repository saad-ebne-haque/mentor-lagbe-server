# MentorLagbe Server

## Setup

1. Install the server dependencies with `npm install`.
2. Set the environment variables listed below in the server environment.
3. Start the development server with `npm run dev`, or start it with `npm start`.
4. Run the server tests with `npm test`.

The API listens on port `5000` by default. Never commit `.env` or put secret
values in source control, this README, or screenshots. The existing Better Auth
`user` collection is the canonical user store; the API does not copy accounts
into a separate `users` collection.

## Environment variables

| Variable                | Required     | Purpose                                                                   |
| ----------------------- | ------------ | ------------------------------------------------------------------------- |
| `MONGODB_SECRET_URI`    | Yes          | MongoDB connection string for the `mentor-lagbe` database.                |
| `BETTER_AUTH_URL`       | Yes          | Exact Better Auth issuer/audience URL and frontend return URL.            |
| `CORS_ORIGINS`          | Production   | Comma-separated allowed website origins, including protocol and no path.  |
| `STRIPE_SECRET_KEY`     | For payments | Creates monthly Pro checkout sessions and retrieves subscription details. |
| `STRIPE_WEBHOOK_SECRET` | For payments | Verifies Stripe webhook signatures.                                       |
| `PORT`                  | No           | HTTP port; defaults to `5000`.                                            |
| `NODE_ENV`              | No           | Set to `production` for production behavior.                              |

Development CORS defaults to `http://localhost:3000` and
`http://127.0.0.1:3000`. Production must explicitly configure `CORS_ORIGINS`.
The health endpoint checks the HTTP process only, not MongoDB connectivity.

## Authentication

The Next.js Better Auth configuration enables its JWT plugin. A signed-in
client can request a token from `GET /api/auth/token` and send it to protected
Express endpoints as `Authorization: Bearer <token>`. The server verifies the
JWT signature with the Better Auth public key stored in MongoDB, checks the
issuer/audience and expiry, then loads the current role and plan from the
existing `user` collection. Role checks are enforced by the API, not by UI
visibility.

## API endpoints

All responses use JSON. Protected endpoints require a valid Bearer token.

| Method   | Path                                      | Access           | Purpose                                                                        |
| -------- | ----------------------------------------- | ---------------- | ------------------------------------------------------------------------------ |
| `GET`    | `/api/tuitions`                           | Public           | List approved and active tuitions.                                             |
| `GET`    | `/api/tuitions/:tuitionId`                | Public           | Read one approved and active tuition.                                          |
| `POST`   | `/api/tuitions`                           | Tutor            | Create a pending tuition; Free Tutors are limited to two posts.                |
| `GET`    | `/api/tutor/tuitions`                     | Tutor            | List the signed-in tutor's listings.                                           |
| `PATCH`  | `/api/tuitions/:tuitionId`                | Owner Tutor      | Update a listing; edits to approved listings return them to pending review.    |
| `PATCH`  | `/api/tuitions/:tuitionId/active`         | Owner Tutor      | Activate or close an approved listing.                                         |
| `DELETE` | `/api/tuitions/:tuitionId`                | Owner Tutor      | Delete an owned listing.                                                       |
| `POST`   | `/api/applications`                       | Student          | Apply to an approved listing; duplicate applications are rejected.             |
| `GET`    | `/api/applications/me`                    | Student          | List the signed-in student's applications.                                     |
| `DELETE` | `/api/applications/:applicationId`        | Owner Student    | Cancel a pending application.                                                  |
| `GET`    | `/api/tutor/applications`                 | Tutor            | List applicants for the signed-in tutor's listings.                            |
| `PATCH`  | `/api/applications/:applicationId/status` | Owner Tutor      | Accept or reject a pending application.                                        |
| `GET`    | `/api/dashboard/student`                  | Student          | Application and plan statistics.                                               |
| `GET`    | `/api/dashboard/tutor`                    | Tutor            | Listing, applicant, and plan statistics.                                       |
| `GET`    | `/api/dashboard/admin`                    | Admin            | User, tuition, and recorded revenue statistics.                                |
| `GET`    | `/api/admin/users`                        | Admin            | List users without credential fields.                                          |
| `PATCH`  | `/api/admin/users/:userId/role`           | Admin            | Change a user's role; admins cannot change their own role.                     |
| `GET`    | `/api/admin/tuitions`                     | Admin            | List all listings for moderation.                                              |
| `PATCH`  | `/api/admin/tuitions/:tuitionId/status`   | Admin            | Approve or reject a listing.                                                   |
| `GET`    | `/api/admin/payments`                     | Admin            | List recorded Stripe payments.                                                 |
| `POST`   | `/api/payments/checkout`                  | Student or Tutor | Create a monthly Stripe Pro subscription ($10 Student / $15 Tutor).            |
| `POST`   | `/api/payments/webhook`                   | Stripe signature | Verify checkout and invoice events, update the plan, and record paid invoices. |

The Stripe webhook must be configured to deliver `checkout.session.completed`
and `invoice.paid` events to `/api/payments/webhook`. Redirects alone do not
upgrade a plan or create payment records. For local testing, use the signing
secret printed by `stripe listen` while it forwards to `localhost:5000`. A
deployed API must use the signing secret from a Stripe Sandbox webhook endpoint
configured with the deployed HTTPS API URL; do not use the local CLI secret
for a deployed endpoint.

## Data and current limitations

The API uses the existing Better Auth `user` collection and the assignment
collections `tuitions`, `applications`, and `payments`. On the first MongoDB
connection, it creates unique indexes to prevent duplicate student applications
and duplicate Stripe invoice records. Existing duplicate data can cause index
creation to fail and should be resolved before deploying this API.

The API does not yet include server-side search/filter, pagination, ImgBB tuition
banner upload, recurring-subscription cancellation, or production deployment
verification. The pricing checkout and payment result pages are connected to
the API; the client dashboard and tuition pages still need to be connected.
