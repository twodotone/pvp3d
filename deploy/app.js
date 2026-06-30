// Static file server for cPanel "Setup Node.js App" (Passenger).
//
// Deploy:
//   1) locally: npm run build   (produces dist/)
//   2) zip dist/ and upload into this app's `public/` folder, then Extract,
//      so you have public/index.html, public/assets/, public/tiles/, etc.
//   3) put this file at the app root as app.js
//   4) cPanel -> Setup Node.js App -> Restart
//
// Zero dependencies — no `npm install` needed.

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "public");
const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};

http
  .createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p === "/") p = "/index.html";
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT)) {
      res.writeHead(403);
      return res.end("Forbidden");
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end("Not found");
      }
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, {
        "Content-Type": TYPES[ext] || "application/octet-stream",
        "Cache-Control": "public, max-age=3600",
      });
      res.end(data);
    });
  })
  .listen(process.env.PORT || 3000);
