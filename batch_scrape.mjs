const ids = process.argv.slice(2);
const concurrency = Math.max(1, Number(process.env.BATCH_CONCURRENCY) || 5);
let next = 0;
let done = 0;

async function worker() {
  while (true) {
    const index = next++;
    if (index >= ids.length) return;
    const id = ids[index];

    try {
      const response = await fetch(
        `http://127.0.0.1:3000/api/scrape?id=${encodeURIComponent(id)}`
      );
      const result = await response.json();
      done += 1;
      console.log(JSON.stringify({
        id,
        status: response.status,
        success: result.success === true,
        error_code: result.error_code || null,
        message: result.message || null,
        details: result.details || null,
        done,
        total: ids.length,
      }));
    } catch (error) {
      done += 1;
      console.log(JSON.stringify({
        id,
        status: 0,
        success: false,
        message: error.message,
        done,
        total: ids.length,
      }));
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));
