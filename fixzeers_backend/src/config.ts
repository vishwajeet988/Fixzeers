import dotenv from "dotenv";

dotenv.config();

const jwtSecret = process.env.JWT_SECRET;

if (!jwtSecret || jwtSecret.length < 32) {
  throw new Error(
    "JWT_SECRET must be configured and at least 32 characters long."
  );
}

const otpHashSecret =
  process.env.OTP_HASH_SECRET ||
  (process.env.NODE_ENV === "production" ? undefined : jwtSecret);

if (!otpHashSecret || otpHashSecret.length < 32) {
  throw new Error(
    "OTP_HASH_SECRET must be configured and at least 32 characters long in production."
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

const corsOrigins = corsOrigin
  .split(",")
  .map(origin => origin.trim())
  .filter(Boolean);

if (corsOrigins.includes("*")) {
  throw new Error(
    "CORS_ORIGIN must explicitly list allowed origins and cannot contain *."
  );
}

if (
  process.env.NODE_ENV === "production" &&
  !corsOrigins.includes("https://fixzeers.vercel.app")
) {
  throw new Error(
    "Production CORS must explicitly allow https://fixzeers.vercel.app."
  );
}

const allowDevelopmentOtpLogs =
  process.env.NODE_ENV === "development" &&
  process.env.ENABLE_DEV_OTP_LOGS === "true";

const otpProvider =
  process.env.OTP_PROVIDER ||
  (process.env.NODE_ENV === "production" ? "twilio" : "console");

if (otpProvider !== "console" && otpProvider !== "twilio") {
  throw new Error(
    "OTP_PROVIDER must be either console or twilio."
  );
}

if (process.env.NODE_ENV === "production" && otpProvider !== "twilio") {
  throw new Error(
    "Production OTP_PROVIDER must be twilio."
  );
}

const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
const twilioFromNumber = process.env.TWILIO_FROM_NUMBER;

if (otpProvider === "twilio" &&
    (!twilioAccountSid || !twilioAuthToken || !twilioFromNumber)) {
  throw new Error(
    "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER are required when OTP_PROVIDER=twilio."
  );
}

export const config = {
  port: Number(process.env.PORT || 4000),
  databaseUrl,
  jwtSecret,
  otpHashSecret,
  corsOrigin,
  corsOrigins,
  allowDevelopmentOtpLogs,
  otpProvider,
  twilioAccountSid,
  twilioAuthToken,
  twilioFromNumber
};
