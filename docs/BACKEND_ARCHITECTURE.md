# Backend Architecture

## Role

`my-aliexpress-crawler` is a scrape executor. It owns browser automation and
returns product JSON. It does not own batch task history, product JSON storage,
upload workflow, or controller UI state.

The controller project is responsible for persistence and orchestration.

## Directory Layout

```text
server.js
src/
  app.js
  config/
    index.js
  controllers/
    cookie.controller.js
    scrape.controller.js
    status.controller.js
  middleware/
    jsonTrafficLogger.js
  routes/
    cookie.routes.js
    index.js
    scrape.routes.js
    status.routes.js
  services/
    cspUrl.service.js
    scrape.service.js
    tabPool.service.js
  utils/
    httpError.js
utils/
  tabScraper.js
  cookieUtils.js
```

## Layer Rules

| Layer | Responsibility |
| --- | --- |
| `server.js` | Start Express, warm Puppeteer, graceful shutdown |
| `src/app.js` | Build Express app and mount `/api` routes |
| `routes` | URL and HTTP method mapping only |
| `controllers` | Read request params, return HTTP responses |
| `services` | Browser scraping, Cookie injection, CSP URL lookup |
| `utils/tabScraper.js` | Low-level Puppeteer implementation |

## API Surface

```http
GET  /api/status
GET  /api/scrape?id=<productId>
POST /api/scrape
POST /api/scrape/csp-attrs
POST /api/cookie/update
POST /api/cookie/csp/update
```

Removed from this service:

```http
POST   /api/jobs
GET    /api/jobs
GET    /api/jobs/:jobId
DELETE /api/jobs
```

Those endpoints now belong to `crawler-upload-controller`.

## Data Ownership

This service may keep technical runtime state:

- `user_data_profile_puppeteer/`: Puppeteer Chrome profile and login state.
- `cookie.txt`: AliExpress cookie backup.
- `cookie_csp.txt`: CSP seller-center cookie backup.

It should not save product JSON as business data. Product JSON persistence is
owned by `crawler-upload-controller/storage/products`.

## Request Flow

```text
crawler-upload-controller
  -> GET /api/scrape?id=...
my-aliexpress-crawler
  -> Puppeteer AliExpress page/API
  -> Flask CSP URL API
  -> Puppeteer CSP page/API
  <- standard product JSON
```

The returned product JSON already includes merged `cspInfo`,
`cspProductAttrs`, and `attributes`.

## Start

```bash
npm run serve
```

Default port: `3000`.
