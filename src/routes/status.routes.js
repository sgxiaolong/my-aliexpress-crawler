import { Router } from "express";
import { statusController } from "../controllers/status.controller.js";

export const statusRoutes = Router();

statusRoutes.get("/status", statusController);
