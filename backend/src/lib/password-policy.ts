import { z } from "zod";

export const PASSWORD_POLICY_MESSAGE =
  "La contrasena debe tener al menos 8 caracteres, una mayuscula, dos numeros y un caracter especial.";

export const strongPasswordSchema = z.string()
  .min(8, PASSWORD_POLICY_MESSAGE)
  .regex(/[A-Z]/, PASSWORD_POLICY_MESSAGE)
  .refine((value) => (value.match(/\d/g) ?? []).length >= 2, PASSWORD_POLICY_MESSAGE)
  .regex(/[^A-Za-z0-9]/, PASSWORD_POLICY_MESSAGE);
