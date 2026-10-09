import assert from "node:assert/strict";
import test from "node:test";
import { fetchCspUrlByProductId } from "../src/services/cspUrl.service.js";

test("CSP 元数据不需要采集渠道，报名链接保持原值", async (t) => {
  const cspUrl = "https://csp.aliexpress.com/biddingRegistration?biddingTaskId=123";
  t.mock.method(globalThis, "fetch", async () => ({
    ok: true,
    json: async () => ({ data: {
      csp_url: cspUrl, period_name: "Test", activity_id: 2, task_id: "123",
    } }),
  }));
  assert.deepEqual(await fetchCspUrlByProductId("101"), {
    cspUrl, periodName: "Test", activityId: 2, taskId: "123",
  });
});
