import { config } from "../config";
import { sendEmail } from "./email";

function appUrl(path = "/") {
  const base = config.publicAppUrl.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

export async function sendWelcomeEmail(input: {
  to: string;
  fullName: string;
  companyName: string;
  username: string;
  temporaryPassword: string;
  saqTypeName?: string;
  cycleYear?: number;
}) {
  const lines = [
    `Hola ${input.fullName},`,
    "",
    `Se ha creado una cuenta en PCI Nexus para ${input.companyName}.`,
    "",
    "Tus credenciales temporales son:",
    `  Usuario: ${input.username}`,
    `  Contrasena temporal: ${input.temporaryPassword}`,
    "",
    input.saqTypeName
      ? `Se te asigno el cuestionario ${input.saqTypeName}${input.cycleYear ? ` para el ciclo ${input.cycleYear}` : ""}.`
      : "",
    "",
    `Ingresa a ${appUrl("/login")} para iniciar sesion. Al primer ingreso se te solicitara cambiar la contrasena.`,
    "",
    "Si no esperabas este correo, ignoralo. La contrasena temporal expirara cuando configures una nueva.",
    "",
    "PCI Nexus",
  ].filter((line, index, all) => !(line === "" && all[index - 1] === ""));

  return sendEmail({
    to: input.to,
    subject: `Acceso a PCI Nexus para ${input.companyName}`,
    text: lines.join("\n"),
  });
}

export async function sendAdditionalUserEmail(input: {
  to: string;
  fullName: string;
  companyName: string;
  username: string;
  temporaryPassword: string;
}) {
  const lines = [
    `Hola ${input.fullName},`,
    "",
    `Se te agrego como usuario de la cuenta de ${input.companyName} en PCI Nexus.`,
    "",
    "Tus credenciales temporales son:",
    `  Usuario: ${input.username}`,
    `  Contrasena temporal: ${input.temporaryPassword}`,
    "",
    `Ingresa a ${appUrl("/login")} para iniciar sesion. Al primer ingreso se te solicitara cambiar la contrasena.`,
    "",
    "PCI Nexus",
  ];

  return sendEmail({
    to: input.to,
    subject: `Acceso a PCI Nexus - ${input.companyName}`,
    text: lines.join("\n"),
  });
}

export async function sendPasswordResetEmail(input: {
  to: string;
  fullName: string;
  resetToken: string;
}) {
  const resetLink = appUrl(`/reset-password?token=${encodeURIComponent(input.resetToken)}`);
  const lines = [
    `Hola ${input.fullName},`,
    "",
    "Recibimos una solicitud para restablecer tu contrasena en PCI Nexus.",
    "",
    `Sigue este enlace dentro de los proximos 60 minutos para definir una nueva contrasena:`,
    resetLink,
    "",
    "Si no solicitaste este cambio puedes ignorar este correo; tu contrasena actual no se modificara.",
    "",
    "PCI Nexus",
  ];

  return sendEmail({
    to: input.to,
    subject: "Restablecer tu contrasena en PCI Nexus",
    text: lines.join("\n"),
  });
}

export async function sendCertificationReopenedEmail(input: {
  to: string;
  fullName: string;
  companyName: string;
  reason: string;
}) {
  const lines = [
    `Hola ${input.fullName},`,
    "",
    `Un administrador reabrio la certificacion finalizada de ${input.companyName} en PCI Nexus.`,
    "",
    `Motivo: ${input.reason}`,
    "",
    `Ingresa a ${appUrl("/")} para revisar el estado actual y completar los ajustes solicitados.`,
    "",
    "PCI Nexus",
  ];

  return sendEmail({
    to: input.to,
    subject: `Certificacion reabierta - ${input.companyName}`,
    text: lines.join("\n"),
  });
}
