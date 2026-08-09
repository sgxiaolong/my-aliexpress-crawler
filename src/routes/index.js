import { Router } from "express";
import { scrapeRoutes } from "./scrape.routes.js";
import { statusRoutes } from "./status.routes.js";

export const apiRoutes = Router();

apiRoutes.use(statusRoutes);
apiRoutes.use(scrapeRoutes);
