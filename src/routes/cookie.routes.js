import { Router } from "express";
import { updateAliCookieController, updateCspCookieController } from "../controllers/cookie.controller.js";

export const cookieRoutes = Router();

cookieRoutes.post("/cookie/update", updateAliCookieController);
cookieRoutes.post("/cookie/csp/update", updateCspCookieController);
