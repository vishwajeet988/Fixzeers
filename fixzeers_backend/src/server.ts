import express from "express";
import cors from "cors";
import { config } from "./config";
import { pool } from "./db";
import authRoutes from "./routes/auth";
import categoryRoutes from "./routes/categories";
import professionalRoutes from "./routes/professionals";
import jobRoutes from "./routes/jobs";
import reviewRoutes from "./routes/reviews";

const app=express();

app.use(cors({origin:config.corsOrigin==="*" ? true : config.corsOrigin}));
app.use(express.json({limit:"1mb"}));

app.get("/api/health",async(_req,res)=>{
  try {
    await pool.query("SELECT 1");
    res.json({status:"ok",service:"fixzeers-backend",database:"connected"});
  } catch {
    res.status(503).json({status:"degraded",service:"fixzeers-backend",database:"disconnected"});
  }
});

app.use("/api/auth",authRoutes);
app.use("/api/categories",categoryRoutes);
app.use("/api/professionals",professionalRoutes);
app.use("/api/jobs",jobRoutes);
app.use("/api/reviews",reviewRoutes);

app.use((_req,res)=>res.status(404).json({error:"Route not found"}));

app.use((err:any,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
  console.error(err);
  res.status(500).json({error:"Internal server error"});
});

app.listen(config.port,()=>console.log(`Fixzeers API running on http://localhost:${config.port}`));
