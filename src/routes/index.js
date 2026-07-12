import { Router } from "express";
import { cookieRoutes } from "./cookie.routes.js";
import { scrapeRoutes } from "./scrape.routes.js";
import { statusRoutes } from "./status.routes.js";

export const apiRoutes = Router();

apiRoutes.use(statusRoutes);
apiRoutes.use(scrapeRoutes);
apiRoutes.use(cookieRoutes);
