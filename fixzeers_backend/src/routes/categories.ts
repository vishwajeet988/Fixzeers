import { Router } from "express";
import { query } from "../db";

const router = Router();

router.get("/",async(_req,res,next)=>{
  try {
    const result = await query(`SELECT id,name,slug FROM categories ORDER BY name`);
    res.json({ categories: result.rows });
  } catch(error) { next(error); }
});

export default router;
