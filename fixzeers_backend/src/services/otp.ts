import { config } from "../config";

export type OtpPurpose = "phone verification" | "password reset";

export interface OtpDeliveryProvider {
  send(phone: string, otp: string, purpose: OtpPurpose): Promise<void>;
}

class ConsoleOtpDeliveryProvider implements OtpDeliveryProvider {
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

export function createOtpDeliveryProvider(): OtpDeliveryProvider {
  return config.otpProvider === "twilio"
    ? new TwilioOtpDeliveryProvider(
        config.twilioAccountSid!,
        config.twilioAuthToken!,
        config.twilioFromNumber!
      )
    : new ConsoleOtpDeliveryProvider();
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
