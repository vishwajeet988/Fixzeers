import dotenv from "dotenv";

dotenv.config();

const nodeEnv = process.env.NODE_ENV || "development";

const jwtSecret = process.env.JWT_SECRET;

if (!jwtSecret || jwtSecret.length < 32) {
  throw new Error(
    "JWT_SECRET must be configured and at least 32 characters long."
  );
}

const otpHashSecret =
  process.env.OTP_HASH_SECRET ||
  (nodeEnv === "production" ? undefined : jwtSecret);

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
  nodeEnv === "production" &&
  !corsOrigins.includes("https://fixzeers.vercel.app")
) {
  throw new Error(
    "Production CORS must explicitly allow https://fixzeers.vercel.app."
  );
}

const allowDevelopmentOtpLogs =
  nodeEnv === "development" &&
  process.env.ENABLE_DEV_OTP_LOGS === "true";

const otpProvider =
  process.env.OTP_PROVIDER ||
  (nodeEnv === "production" ? "twilio" : "console");

if (otpProvider !== "console" && otpProvider !== "twilio" && otpProvider !== "qa") {
  throw new Error(
    "OTP_PROVIDER must be either console, twilio, or qa."
  );
}

const qaOtpEnabled = process.env.QA_OTP_ENABLED === "true";
const qaOtpPhoneNumbers = (process.env.QA_OTP_PHONE_NUMBERS || "")
  .split(",")
  .map(phone => phone.trim())
  .filter(Boolean);

export function validateQaOtpConfiguration(
  environment: string,
  provider: string,
  enabled: boolean,
  phoneNumbers: string[]
) {
  if (environment === "production" && enabled) {
    throw new Error("QA OTP cannot be enabled in production.");
  }

  if (environment === "production" && provider !== "twilio") {
    throw new Error("Production OTP_PROVIDER must be twilio.");
  }

  if (provider === "qa" && !enabled) {
    throw new Error("QA OTP requires QA_OTP_ENABLED=true.");
  }

  if (provider === "qa" && phoneNumbers.length === 0) {
    throw new Error(
      "QA_OTP_PHONE_NUMBERS must contain at least one phone number when OTP_PROVIDER=qa."
    );
  }
}

validateQaOtpConfiguration(
  nodeEnv,
  otpProvider,
  qaOtpEnabled,
  qaOtpPhoneNumbers
);

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
  nodeEnv,
  databaseUrl,
  jwtSecret,
  otpHashSecret,
  corsOrigin,
  corsOrigins,
  allowDevelopmentOtpLogs,
  otpProvider,
  qaOtpEnabled,
  qaOtpPhoneNumbers,
  twilioAccountSid,
  twilioAuthToken,
  twilioFromNumber
};
