// Converts ../REPORT.md to ../REPORT.html (then printed to PDF with Edge).
const fs = require("fs"), path = require("path");
const { marked } = require("marked");
const root = path.join(__dirname, "..");
const md = fs.readFileSync(path.join(root, "REPORT.md"), "utf8");
const css = `body{font-family:Calibri,Arial,sans-serif;color:#1F2328;max-width:820px;margin:32px auto;line-height:1.5;font-size:11pt}
h1{color:#1B2A4A;font-size:26pt;margin-bottom:4px}h2{color:#1B2A4A;border-bottom:1px solid #E5E7EB;padding-bottom:4px;margin-top:28px}
h3{color:#1B2A4A}table{border-collapse:collapse;margin:12px 0;font-size:10pt}th{background:#1B2A4A;color:#fff;text-align:left}
th,td{padding:5px 9px;border:1px solid #E5E7EB}tr:nth-child(even) td{background:#EEF1F6}img{max-width:100%;margin:8px 0}
code,pre{font-family:Consolas,monospace;font-size:9.5pt;background:#EEF1F6}pre{padding:10px;border-radius:6px;overflow-x:auto}
blockquote{border-left:4px solid #E0A100;margin:12px 0;padding:6px 14px;background:#FCF6E3}h2,h3{page-break-after:avoid}img,table{page-break-inside:avoid}`;
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Connect-N AI Report</title><style>${css}</style></head><body>${marked.parse(md)}</body></html>`;
fs.writeFileSync(path.join(root, "REPORT.html"), html);
console.log("wrote REPORT.html");
