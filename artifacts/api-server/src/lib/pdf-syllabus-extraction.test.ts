import test from "node:test";
import assert from "node:assert/strict";
import { extractPdfSyllabus, PdfSyllabusError } from "./pdf-syllabus-extraction";
import { fictionalSyllabusPdf } from "./__fixtures__/syllabus-pdf";

const input = { filename: "fictional.pdf", pdfBase64: fictionalSyllabusPdf() };
const result = {
  course: { name: "Fictional Study Skills", code: "FIC 101" },
  assignments: [{ title: "Reflection Essay", type: "paper", dueDate: "2027-02-15" }],
  policyNotes: [], ambiguities: [],
};
const base = { model: "configured-model", schema: {} };

test("extracts actual PDF text locally and sends text only with the timeout and SDK retries disabled", async () => {
  let calls = 0;
  const response = await extractPdfSyllabus(input, { ...base, generate: async request => {
    calls++;
    const contents = request.contents as { parts: { text?: string; inlineData?: unknown }[] }[];
    assert.equal(contents.length, 1);
    assert.ok(contents[0].parts.every(part => typeof part.text === "string" && !part.inlineData));
    assert.match(contents[0].parts[0].text!, /\[Page 1\]/);
    assert.match(contents[0].parts[0].text!, /Reflection Essay/);
    assert.doesNotMatch(contents[0].parts[0].text!, /JVBERi0/);
    assert.equal(request.config?.httpOptions?.timeout, 60_000);
    assert.equal(request.config?.httpOptions?.retryOptions?.attempts, 1);
    assert.ok(request.config?.abortSignal);
    return { text: JSON.stringify(result) };
  }});
  assert.equal(calls, 1);
  assert.equal(response.assignments[0].dueDate, "2027-02-15");
});

test("normalizes syllabus clock times before the semester state validator receives them", async () => {
  const response = await extractPdfSyllabus(input, {
    ...base,
    generate: async () => ({
      text: JSON.stringify({
        ...result,
        assignments: [
          { ...result.assignments[0], dueTime: "11:59 PM ET" },
          { ...result.assignments[0], title: "Midnight Quiz", dueTime: "12:00 AM" },
          { ...result.assignments[0], title: "Noon Review", dueTime: "12:00 PM" },
        ],
      }),
    }),
  });
  assert.deepEqual(response.assignments.map((assignment) => assignment.dueTime), ["23:59", "00:00", "12:00"]);
});

test("keeps an unclear due time blank and surfaces it as an ambiguity", async () => {
  const response = await extractPdfSyllabus(input, {
    ...base,
    generate: async () => ({
      text: JSON.stringify({
        ...result,
        assignments: [{ ...result.assignments[0], dueTime: "after the lecture" }],
      }),
    }),
  });
  assert.equal(response.assignments[0].dueTime, null);
  assert.match(response.ambiguities[0], /verify it in the source syllabus/);
});

test("retries once after a failed generation", async () => {
  let calls = 0;
  await extractPdfSyllabus(input, { ...base, generate: async () => {
    if (++calls === 1) throw { status: 503 };
    return { text: JSON.stringify(result) };
  }, waitBeforeRetry: async () => {} });
  assert.equal(calls, 2);
});

test("two upstream failures produce a clear error and never make a third attempt", async () => {
  let calls = 0;
  await assert.rejects(extractPdfSyllabus(input, { ...base, generate: async () => {
    calls++;
    throw { status: 503 };
  }, waitBeforeRetry: async () => {}}), (error: unknown) => {
    assert.ok(error instanceof PdfSyllabusError);
    assert.equal(error.attempts, 2);
    assert.equal(error.status, 502);
    assert.match(error.message, /2 attempts \(one retry\).*HTTP 503.*No syllabus was saved/);
    return true;
  });
  assert.equal(calls, 2);
});

test("preserves the provider's safe reason when a 503 reports model overload", async () => {
  let calls = 0;
  const delays: number[] = [];
  const error = JSON.stringify({
    error: {
      code: 503,
      message: "This model is currently experiencing high demand. Please try again later.",
      status: "UNAVAILABLE",
    },
  });
  await assert.rejects(extractPdfSyllabus(input, { ...base, generate: async () => {
    calls++;
    throw { status: 503, message: error };
  }, waitBeforeRetry: async delay => { delays.push(delay); }}), (failure: unknown) => {
    assert.ok(failure instanceof PdfSyllabusError);
    assert.match(failure.message, /HTTP 503: This model is currently experiencing high demand/);
    assert.match(failure.message, /No syllabus was saved/);
    return true;
  });
  assert.equal(calls, 2);
  assert.deepEqual(delays, [5_000]);
});

test("hung requests are aborted at each deadline, with only one retry", async () => {
  const signals: AbortSignal[] = [];
  await assert.rejects(extractPdfSyllabus(input, { ...base, timeoutMs: 10, generate: request => {
    signals.push(request.config!.abortSignal!);
    return new Promise(() => {});
  }}), /Last error: timed out after 0.01 seconds/);
  assert.equal(signals.length, 2);
  assert.ok(signals.every(signal => signal.aborted));
});

test("unreadable PDFs fail clearly without calling Gemini", async () => {
  let calls = 0;
  await assert.rejects(extractPdfSyllabus({ ...input, pdfBase64: Buffer.from("not a PDF").toString("base64") }, {
    ...base, generate: async () => { calls++; return {}; },
  }), /not a valid PDF/);
  assert.equal(calls, 0);
});

test("image-only or blank PDFs fail clearly without calling Gemini", async () => {
  let calls = 0;
  await assert.rejects(extractPdfSyllabus({ ...input, pdfBase64: fictionalSyllabusPdf([]) }, {
    ...base, generate: async () => { calls++; return {}; },
  }), /No readable text.*text-based PDF/);
  assert.equal(calls, 0);
});

test("invalid AI JSON also stops after one retry", async () => {
  let calls = 0;
  await assert.rejects(extractPdfSyllabus(input, { ...base, generate: async () => {
    calls++; return { text: "not JSON" };
  }}), /2 attempts.*invalid response/);
  assert.equal(calls, 2);
});
