import { config } from "../config/index.js";

let activeTabs = 0;
const tabQueue = [];

export const getTabPoolStatus = () => ({
  activeTabs,
  maxConcurrentTabs: config.maxConcurrentTabs,
  queuedTabs: tabQueue.length,
});

export const acquireTabSlot = () => {
  if (activeTabs < config.maxConcurrentTabs) {
    activeTabs++;
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    tabQueue.push(resolve);
  });
};

export const releaseTabSlot = () => {
  if (tabQueue.length > 0) {
    const nextResolve = tabQueue.shift();
    nextResolve();
  } else {
    activeTabs = Math.max(0, activeTabs - 1);
  }
};
