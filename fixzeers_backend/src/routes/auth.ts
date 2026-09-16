import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { query } from "../db";
import { config } from "../config";
import { requireAuth } from "../middleware/auth";
import { AuthRequest } from "../types";

const router = Router();

const registerSchema = z.object({
  name: z.string().min(2).max(120),
  phone: z.string().min(10).max(20),
  email: z.string().email().optional(),
  password: z.string().min(6).max(100),
  role: z.enum(["customer","professional"]).default("customer")
});

const loginSchema = z.object({
  phone: z.string().min(10).max(20),
  password: z.string().min(6)
});

function signToken(id: string, role: string) {
  return jwt.sign({ id, role }, config.jwtSecret, { expiresIn: "7d" });
}

router.post("/register", async (req, res, next) => {
  try {
    const data = registerSchema.parse(req.body);
    const hash = await bcrypt.hash(data.password, 12);

    const result = await query<any>(
      `INSERT INTO users(name,phone,email,password_hash,role)
       VALUES($1,$2,$3,$4,$5)
       RETURNING id,name,phone,email,role`,
      [data.name,data.phone,data.email ?? null,hash,data.role]
    );

    const user = result.rows[0];

    if (data.role === "professional") {
      await query(
        `INSERT INTO professional_profiles(user_id) VALUES($1)
         ON CONFLICT(user_id) DO NOTHING`,
        [user.id]
      );
      await query(
        `INSERT INTO reputation_scores(professional_id) VALUES($1)
         ON CONFLICT DO NOTHING`,
        [user.id]
      );
    }

    res.status(201).json({ user, token: signToken(user.id,user.role) });
  } catch (error: any) {
    if (error?.code === "23505")
      return res.status(409).json({ error: "Phone or email already registered" });
    if (error?.name === "ZodError")
      return res.status(400).json({ error: "Invalid registration data", details: error.issues });
    next(error);
  }
});

router.post("/login", async (req,res,next) => {
  try {
    const data = loginSchema.parse(req.body);
    const result = await query<any>(
      `SELECT id,name,phone,email,role,password_hash FROM users WHERE phone=$1`,
      [data.phone]
    );
    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(data.password,user.password_hash)))
      return res.status(401).json({ error: "Invalid phone or password" });

    delete user.password_hash;
    res.json({ user, token: signToken(user.id,user.role) });
  } catch (error: any) {
    if (error?.name === "ZodError")
      return res.status(400).json({ error: "Invalid login data" });
    next(error);
  }
});

router.get("/me",requireAuth,async(req:AuthRequest,res,next)=>{
  try {
    const result = await query(
      `SELECT id,name,phone,email,role,created_at FROM users WHERE id=$1`,
      [req.user!.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "User not found" });
    res.json({ user: result.rows[0] });
  } catch(error) { next(error); }
});

export default router;
