// Dev-only screenshot harness: injects Basic auth so headless chromium can
// render the app (modern chromium refuses credentials in URLs). Transient —
// not part of the product; run against a dev backend, never prod.
import { createServer } from "node:http";

const UPSTREAM = process.env.EZ_SHOT_UPSTREAM || "http://127.0.0.1:5173";
const AUTH =
  "Basic " +
  Buffer.from(process.env.EZ_SHOT_AUTH || "admin:secret").toString("base64");
const PORT = Number(process.env.EZ_SHOT_PORT || 5180);

const srv = createServer(async (req, res) => {
  try {
    const up = await fetch(UPSTREAM + req.url, {
      headers: { authorization: AUTH },
    });
    res.writeHead(up.status, {
      "content-type":
        up.headers.get("content-type") || "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    for await (const chunk of up.body) res.write(chunk);
    res.end();
  } catch (e) {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end("proxy error: " + e.message);
  }
});

srv.listen(PORT, "127.0.0.1", () =>
  console.log(`shot proxy on http://127.0.0.1:${PORT}`),
);
