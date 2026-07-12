import { Router } from "express";
import { scrapeCspAttrsController, scrapeProductController } from "../controllers/scrape.controller.js";

export const scrapeRoutes = Router();

scrapeRoutes.get("/scrape", scrapeProductController);
scrapeRoutes.post("/scrape", scrapeProductController);
scrapeRoutes.post("/scrape/csp-attrs", scrapeCspAttrsController);
