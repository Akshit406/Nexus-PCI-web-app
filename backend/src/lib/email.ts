import nodemailer from "nodemailer";
import { config } from "../config";

type EmailInput = {
  to: string;
  subject: string;
  text: string;
};

export async function sendEmail(input: EmailInput) {
  if (!config.smtpHost || !config.smtpUser || !config.smtpPass) {
    console.log(`[email:dev] To: ${input.to}\nSubject: ${input.subject}\n${input.text}`);
    return { sent: false, devMode: true };
  }

  const transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpPort === 465,
    auth: {
      user: config.smtpUser,
      pass: config.smtpPass,
    },
  });

  await transporter.sendMail({
    from: config.mailFrom,
    to: input.to,
    subject: input.subject,
    text: input.text,
  });

  return { sent: true, devMode: false };
}
