import { Request } from "express";

export type AuthUser = {
  id: string;
  role: "customer" | "professional" | "admin";
};

export interface AuthRequest extends Request {
  user?: AuthUser;
}
