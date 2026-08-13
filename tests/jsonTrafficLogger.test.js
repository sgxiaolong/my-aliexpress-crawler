import assert from "node:assert/strict";
import test from "node:test";
import { jsonTrafficLogger } from "../src/middleware/jsonTrafficLogger.js";

test("JSON 请求日志不会写出凭据字段", (t) => {
  const originalLog = console.log;
  const messages = [];
  console.log = (...values) => messages.push(values.join(" "));
  t.after(() => {
    console.log = originalLog;
  });

  const req = {
    path: "/api/scrape",
    method: "POST",
    url: "/api/scrape",
    body: { productId: "1005012308396991", nested: { accessToken: "secret-token" } },
  };
  const res = { statusCode: 200, json(body) { return body; } };
  let nextCalled = false;

  jsonTrafficLogger(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  const output = messages.join("\n");
  assert.doesNotMatch(output, /secret-token/);
  assert.match(output, /<redacted>/);
});
