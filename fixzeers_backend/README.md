# Fixzeers Backend — MVP

Reputation-first local services API for Fixzeers.

## Stack
Node.js, Express, TypeScript, PostgreSQL, JWT, bcrypt, Zod.

## Setup

1. Install Node.js 20+ and PostgreSQL.
2. Create a PostgreSQL database named `fixzeers`.
3. Apply the database files in order:
   `database/schema.sql`, then migrations
   `001_indexes_and_constraints.sql` through `006_professional_skills.sql`.
4. Copy `.env.example` to `.env` and update credentials. Keep
   `ENABLE_DEV_OTP_LOGS=false`; OTPs must never be logged in production.
   Production must set `CORS_ORIGIN=https://fixzeers.vercel.app`,
   `OTP_PROVIDER=twilio`, `OTP_HASH_SECRET`, and the Twilio account,
   auth-token, and sender number variables. Never commit those secrets.
   For non-production QA, set `OTP_PROVIDER=qa`,
   `QA_OTP_ENABLED=true`, and `QA_OTP_PHONE_NUMBERS` to a comma-separated
   allowlist of test numbers. QA OTPs are only logged for those numbers and
   are rejected in production.
5. Run `npm install`.
6. Run `npm run build`.
7. Run `npm run dev`.

API: http://localhost:4000
Health: GET /api/health

## Core flow
Customer/professional auth → professional discovery → job request → job lifecycle → customer confirmation → review → Fixzeer Score.

Government ID is intentionally not required in this MVP.
