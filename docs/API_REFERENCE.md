# API Reference

`my-aliexpress-crawler` is a scrape executor. All APIs return scrape or browser
runtime results only. Batch jobs and product JSON persistence live in
`crawler-upload-controller`.

## Status

```http
GET /api/status
```

Returns browser profile and tab-pool status:

```json
{
  "success": true,
  "service": "AliExpress Scraper HTTP API",
  "role": "scrape-executor",
  "status": "healthy",
  "active_tabs": 0,
  "max_concurrent_tabs": 1,
  "queued_tabs": 0
}
```

## Scrape Product

```http
GET /api/scrape?id=1005012308396991
POST /api/scrape
Content-Type: application/json

{
  "productId": "1005012308396991"
}
```

Returns full product JSON:

```json
{
  "success": true,
  "mode": "Browser-Tab-Pool (Plan A)",
  "timestamp": "...",
  "data": {
    "title": "...",
    "mainImage": "...",
    "cspInfo": {},
    "cspProductAttrs": {},
    "attributes": {}
  }
}
```

The crawler does not save this JSON. Callers that need persistence must save the
response themselves.

## Scrape CSP Attributes

```http
POST /api/scrape/csp-attrs
Content-Type: application/json

{
  "productId": "1005012308396991"
}
```

or:

```json
{
  "cspUrl": "https://csp.aliexpress.com/..."
}
```

## Cookie Update

```http
POST /api/cookie/update
POST /api/cookie/csp/update
Content-Type: application/json

{
  "cookie": "a=1; b=2"
}
```

Cookie updates are written to crawler-side cookie files and injected into the
running Puppeteer browser profile.

## Removed APIs

These APIs are intentionally not part of the crawler anymore:

```http
POST   /api/jobs
GET    /api/jobs
GET    /api/jobs/:jobId
DELETE /api/jobs
```

Use `crawler-upload-controller` for jobs and saved JSON.
