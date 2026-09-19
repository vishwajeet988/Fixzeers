import { config } from "../config";

export type OtpPurpose = "phone verification" | "password reset";

export interface OtpDeliveryProvider {
  canSend(phone: string): boolean;
  send(phone: string, otp: string, purpose: OtpPurpose): Promise<void>;
}

class ConsoleOtpDeliveryProvider implements OtpDeliveryProvider {
  canSend(_phone: string) {
    return true;
  }

  async send(phone: string, otp: string, purpose: OtpPurpose) {
    if (config.allowDevelopmentOtpLogs) {
      console.log(`[DEV OTP] ${purpose} for ${phone}: ${otp}`);
    }
  }
}

type FetchImplementation = typeof fetch;

class TwilioOtpDeliveryProvider implements OtpDeliveryProvider {
  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly fromNumber: string,
    private readonly fetchImplementation: FetchImplementation = fetch
  ) {}

  canSend(_phone: string) {
    return true;
  }

  async send(phone: string, otp: string, purpose: OtpPurpose) {
    const body = new URLSearchParams({
      To: phone,
      From: this.fromNumber,
      Body: `Your Fixzeers ${purpose} OTP is ${otp}. It expires in 10 minutes.`
    });

    const response = await this.fetchImplementation(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.accountSid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body
      }
    );

    if (!response.ok) {
      throw new Error(`OTP delivery failed with status ${response.status}.`);
    }
  }
}

class QaOtpDeliveryProvider implements OtpDeliveryProvider {
  constructor(
    private readonly phoneNumbers: readonly string[],
    private readonly logger: (message: string) => void,
    private readonly environment: string
  ) {}

  canSend(phone: string) {
    return this.phoneNumbers.includes(phone);
  }

  async send(phone: string, otp: string, purpose: OtpPurpose) {
    if (this.environment === "production") {
      throw new Error("QA OTP cannot be used in production.");
    }

    if (!this.canSend(phone)) {
      throw new Error("QA OTP is only available for configured test phone numbers.");
    }

    this.logger(`[QA OTP] ${purpose} for ${phone}: ${otp}`);
  }
}

export function createOtpDeliveryProvider(): OtpDeliveryProvider {
  if (config.otpProvider === "twilio") {
    return new TwilioOtpDeliveryProvider(
        config.twilioAccountSid!,
        config.twilioAuthToken!,
        config.twilioFromNumber!
      );
  }

  if (config.otpProvider === "qa") {
    return new QaOtpDeliveryProvider(
      config.qaOtpPhoneNumbers,
      console.log,
      config.nodeEnv
    );
  }

  return new ConsoleOtpDeliveryProvider();
}

export function createQaOtpDeliveryProvider(
  phoneNumbers: readonly string[],
  logger: (message: string) => void,
  environment = "development"
): OtpDeliveryProvider {
  return new QaOtpDeliveryProvider(phoneNumbers, logger, environment);
}

export function createTwilioOtpDeliveryProvider(
  accountSid: string,
  authToken: string,
  fromNumber: string,
  fetchImplementation: FetchImplementation
): OtpDeliveryProvider {
  return new TwilioOtpDeliveryProvider(
    accountSid,
    authToken,
    fromNumber,
    fetchImplementation
  );
}

export const otpDeliveryProvider = createOtpDeliveryProvider();
