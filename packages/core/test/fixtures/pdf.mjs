// A PDF made by hand, for tests: one page per string, each with that text on it and an
// orange box below it, so a drawn page and a crop of it can be checked by colour.
export function makePdf(pages) {
  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageIds = [];
  for (const text of pages) {
    const stream = `1 0.35 0.06 rg 72 400 300 200 re f BT /F1 28 Tf 72 720 Td (${text.replace(/[()\\]/g, "\\$&")}) Tj ET`;
    const c = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent PAGES 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${c} 0 R >>`));
  }
  const pagesObj = add(`<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
  const cat = add(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`);
  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o.replace("PAGES", String(pagesObj))}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root ${cat} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
