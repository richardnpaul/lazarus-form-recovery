const fs = require('fs');

const data = JSON.parse(fs.readFileSync('coverage/coverage-final.json', 'utf8'));
const rows = [];

for (const file of Object.keys(data).sort()) {
  const f = data[file];
  const s = Object.values(f.s);
  const total = s.length;
  const covered = s.filter(v => v > 0).length;
  const pct = total ? Number((covered / total * 100).toFixed(1)) : 100.0;
  const short = file.replace(/.*\/src\//, 'src/');
  rows.push({ pct, covered, total, short });
}

rows.sort((a, b) => a.pct - b.pct);
for (const r of rows) {
  console.log(`${String(r.pct).padStart(5)}% (${String(r.covered).padStart(3)}/${String(r.total).padStart(3)}) : ${r.short}`);
}
