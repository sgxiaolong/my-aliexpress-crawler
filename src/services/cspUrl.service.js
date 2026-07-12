import { config } from "../config/index.js";

export async function fetchCspUrlByProductId(productId) {
  const apiUrl = `${config.flaskBiddingApi}/bidding/csp-url?super_link_id=${productId}`;
  console.log(`[CSP-URL] Query latest bidding URL: ${apiUrl}`);

  const resp = await fetch(apiUrl, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15000),
  });

  if (!resp.ok) {
    throw new Error(`Flask 竞价 URL 接口返回 HTTP ${resp.status}`);
  }

  const json = await resp.json();
  const data = json?.data || json;
  if (!data?.csp_url) {
    throw new Error(
      `CSP_ACTIVITY_NOT_FOUND: ${json?.msg || json?.message || `商品 ${productId} 未找到对应竞价活动快照`}`
    );
  }

  return {
    cspUrl: data.csp_url,
    periodName: data.period_name,
    activityId: data.activity_id,
    taskId: data.task_id,
    channelId: data.channel_id,
  };
}
