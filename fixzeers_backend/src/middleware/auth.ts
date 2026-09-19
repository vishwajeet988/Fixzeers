import { NextFunction, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { AuthRequest, AuthUser } from "../types";
import { query } from "../db";

export async function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) return res.status(401).json({ error: "Authentication required" });

  try {
    const tokenUser = jwt.verify(token, config.jwtSecret) as AuthRequest["user"];

    if (!tokenUser?.id) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    const result = await query<{ id: string; role: AuthUser["role"] }>(
      `SELECT id, role
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [tokenUser.id]
    );

    const currentUser = result.rows[0];

    if (!currentUser) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    req.user = currentUser;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    next();
  };
}
