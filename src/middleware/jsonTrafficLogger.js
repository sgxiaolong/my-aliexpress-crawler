export const jsonTrafficLogger = (req, res, next) => {
  if (req.path === "/api/status") return next();

  console.log(`\n=================== [${req.method} ${req.url}] ===================`);
  if (Object.keys(req.body || {}).length > 0) {
    console.log("Request JSON:", JSON.stringify(req.body, null, 2));
  }

  const oldJson = res.json;
  res.json = function jsonWithLog(body) {
    console.log(`Response HTTP ${res.statusCode}:`);
    const previewBody = JSON.parse(JSON.stringify(body));
    if (previewBody.data && typeof previewBody.data === "object") {
      console.log(`  { success: ${previewBody.success}, mode: "${previewBody.mode}", data: ... }`);
    } else {
      console.log(" ", JSON.stringify(previewBody, null, 2));
    }
    console.log("================================================================");
    return oldJson.call(this, body);
  };

  next();
};
