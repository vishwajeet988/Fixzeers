import dotenv from "dotenv";

dotenv.config();

const jwtSecret = process.env.JWT_SECRET;

if (!jwtSecret || jwtSecret.length < 32) {
  throw new Error(
    "JWT_SECRET must be configured and at least 32 characters long."
  );
}

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL must be configured."
  );
}

const corsOrigin = process.env.CORS_ORIGIN;

if (!corsOrigin) {
  throw new Error(
    "CORS_ORIGIN must be configured."
  );
}

export const config = {
  port: Number(process.env.PORT || 4000),
  databaseUrl,
  jwtSecret,
  corsOrigin
};