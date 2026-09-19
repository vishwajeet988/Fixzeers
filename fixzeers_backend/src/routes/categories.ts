import { Router } from "express";
import { query } from "../db";
import {
  completeRouteTiming,
  startRouteTiming
} from "../observability";

const router = Router();

router.get("/",async(_req,res,next)=>{
  const routeStartedAt = startRouteTiming();

  try {
    const result = await query(
      `SELECT id,name,slug FROM categories ORDER BY name`,
      [],
      "categories.list"
    );
    res.json({ categories: result.rows });
  } catch(error) {
    next(error);
  } finally {
    completeRouteTiming("categories.list", routeStartedAt);
  }
});

export default router;
