import express from "express";
import { jsonTrafficLogger } from "./middleware/jsonTrafficLogger.js";
import { apiRoutes } from "./routes/index.js";

export const createApp = () => {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use(jsonTrafficLogger);
  app.use("/api", apiRoutes);
  return app;
};
