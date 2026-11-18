import { existsSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { configuredGeminiModel, extractUploadedSyllabus } from "./routes/syllabi";
import { fictionalSyllabusPdf } from "./lib/__fixtures__/syllabus-pdf";
import { PdfSyllabusError } from "./lib/pdf-syllabus-extraction";

const file = path.resolve(import.meta.dirname, "../../../.env");
if (existsSync(file)) process.loadEnvFile(file);
if (!process.argv.includes("--live")) throw new Error("Pass --live for one fictional PDF extraction test, with at most two Gemini attempts.");
const model = process.argv.find(arg => arg.startsWith("--model="))?.slice("--model=".length) || configuredGeminiModel();
const started = Date.now();
try {
  const result = await extractUploadedSyllabus(
    { filename: "fictional-syllabus.pdf", pdfBase64: fictionalSyllabusPdf() },
    event => console.log(JSON.stringify(event)),
    model,
  );
  assert.equal(result.course.code.replace(/\s/g, ""), "FIC101");
  assert.ok(result.assignments.some(a => /reflection/i.test(a.title) && a.dueDate === "2027-02-15"));
  console.log(JSON.stringify({ outcome: "passed", model, elapsedMs: Date.now() - started, result }));
} catch (error) {
  console.error(JSON.stringify({
    outcome: "failed", model, elapsedMs: Date.now() - started,
    error: error instanceof PdfSyllabusError ? error.message : error instanceof assert.AssertionError
      ? "The returned course/deadline did not match the fictional syllabus." : "Unexpected extraction test error.",
  }));
  process.exitCode = 1;
}
