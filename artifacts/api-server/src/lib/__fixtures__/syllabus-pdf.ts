export function fictionalSyllabusPdf(lines = [
  "Fictional Study Skills - FIC 101",
  "Semester: January 11 to May 7, 2027",
  "Reflection Essay: due February 15, 2027 at 23:59. Worth 20% of final grade.",
  "Estimated effort: 4 hours. Late work: one day late accepted with a 5% deduction.",
]) {
  const stream = `BT /F1 12 Tf 50 750 Td ${lines.map((line, i) =>
    `${i ? "0 -24 Td " : ""}(${line.replace(/[\\()]/g, "\\$&")}) Tj`).join("\n")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf).toString("base64");
}
