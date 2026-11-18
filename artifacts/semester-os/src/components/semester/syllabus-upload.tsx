import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "wouter";
import { Check, FileText, Upload, X } from "lucide-react";
import { useDialogFocus } from "@/hooks/use-dialog-focus";
import { useExtractSyllabus } from "@workspace/api-client-react";
import type { SemesterState, SyllabusExtraction } from "@workspace/api-client-react";
import {
  applyApprovedSyllabus,
  getSyllabusChanges,
  normalizedTitle,
  syllabusMatches,
  type AssignmentMatches,
} from "@/lib/syllabus-import";

type UploadItem = {
  file: File;
  courseId: string;
  status: "selected" | "processing" | "needs-review" | "approved" | "failed";
  extraction?: SyllabusExtraction;
  error?: string;
  matches?:AssignmentMatches;
};

type SyllabusUploadProps = {
  state: SemesterState;
  update: (recipe: (current: SemesterState) => SemesterState) => void;
  isSignedIn: boolean;
  onClose: () => void;
};

function readPdf(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The PDF could not be read."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

function UploadModal({ title, subtitle, onClose, children }: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useDialogFocus(true,onClose);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <div><h2>{title}</h2><p className="card-caption">{subtitle}</p></div>
          <button type="button" onClick={onClose} className="modal-close" aria-label="Close" data-testid="button-close-modal"><X size={19}/></button>
        </div>
        {children}
      </section>
    </div>
  );
}

export function SyllabusUpload({ state, update, isSignedIn, onClose }: SyllabusUploadProps) {
  const extract = useExtractSyllabus();
  const [items, setItems] = useState<UploadItem[]>([]);
  const [reviewIndex, setReviewIndex] = useState<number | null>(null);
  const [processingIndex, setProcessingIndex] = useState<number | null>(null);
  const [processing, setProcessing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const reviewItem = reviewIndex == null ? null : items[reviewIndex];

  const addFiles = (fileList: FileList | File[]) => {
    setError("");
    const selected = Array.from(fileList);
    if (selected.length > 5) {
      setError("Choose up to five PDF syllabi at a time.");
      return;
    }
    const accepted: UploadItem[] = [];
    const errors: string[] = [];
    for (const file of selected) {
      if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
        errors.push(`${file.name}: choose a PDF file.`);
      } else if (file.size < 100) {
        errors.push(`${file.name}: the file is too small to be a valid PDF.`);
      } else if (file.size > 10 * 1024 * 1024) {
        errors.push(`${file.name}: the file is larger than 10 MB.`);
      } else if (accepted.some((item) => item.file.name === file.name && item.file.size === file.size)) {
        errors.push(`${file.name}: duplicate selection skipped.`);
      } else {
        accepted.push({ file, courseId: "", status: "selected" });
      }
    }
    if (!accepted.length && errors.length) setError(errors.join(" "));
    else {
      setItems(accepted);
      setReviewIndex(null);
      if (errors.length) setError(errors.join(" "));
    }
  };

  const runExtraction = async () => {
    if (!isSignedIn || processing || !items.length) return;
    setProcessing(true);
    setError("");
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (item.status === "approved" || item.extraction) continue;
      setProcessingIndex(index);
      setItems((current) => current.map((entry, i) => i === index ? { ...entry, status: "processing", error: undefined } : entry));
      try {
        const dataUrl = await readPdf(item.file);
        const pdfBase64 = dataUrl.split(",")[1] || "";
        if (!atob(pdfBase64.slice(0, 16)).startsWith("%PDF-")) {
          throw new Error("This file does not contain a valid PDF signature.");
        }
        const extraction = await extract.mutateAsync({
          data: { filename: item.file.name, pdfBase64 },
        });
        const suggestedCourse = state.courses.find(
          (course) => normalizedTitle(course.code) === normalizedTitle(extraction.course.code),
        );
        setItems((current) => current.map((entry, i) =>
          i === index
            ? { ...entry, extraction, courseId: suggestedCourse?.id || "", status: "needs-review", error: undefined }
            : entry,
        ));
      } catch (caught) {
        const serverError = (caught as { data?: { error?: unknown } })?.data?.error;
        const message = typeof serverError === "string" ? serverError : caught instanceof Error ? caught.message : "The PDF could not be processed.";
        setItems((current) => current.map((entry, i) =>
          i === index ? { ...entry, status: "failed", error: message } : entry,
        ));
      }
    }
    setProcessingIndex(null);
    setProcessing(false);
  };

  const approveCurrent = () => {
    if (!reviewItem?.extraction || reviewIndex == null) return;
    update((current) => applyApprovedSyllabus(current, {
      extraction: reviewItem.extraction!,
      courseId: reviewItem.courseId,
      filename: reviewItem.file.name,
      matches: reviewItem.matches,
    }));
    const updatedItems = items.map((item, index) =>
      index === reviewIndex ? { ...item, status: "approved" as const } : item,
    );
    setItems(updatedItems);
    const nextIndex = updatedItems.findIndex((item) => item.status === "needs-review");
    setReviewIndex(nextIndex === -1 ? null : nextIndex);
  };

  const updateReview = (extraction: SyllabusExtraction) => {
    if (reviewIndex == null) return;
    setItems((current) => current.map((item, index) =>
      index === reviewIndex ? { ...item, extraction } : item,
    ));
  };

  const statusLabel = (item: UploadItem, index: number) => {
    if (item.status === "processing") return `Processing ${index + 1} of ${items.length}`;
    if (item.status === "needs-review") return "Ready to review";
    if (item.status === "approved") return "Approved and saved";
    if (item.status === "failed") return "Could not process";
    return "Waiting";
  };

  return (
    <UploadModal title="Add syllabi" subtitle="Review every extracted detail before it changes your semester." onClose={onClose}>
      <div className="notice coral" style={{ marginBottom: 14 }}>
        Text is extracted from your PDF on the server; only that text is sent to Gemini. Original PDFs are not stored. Each syllabus
        stays separate so you can review and approve it before saving.
      </div>
      {!isSignedIn ? (
        <div className="notice" data-testid="notice-upload-sign-in">
          Syllabus extraction requires an account. Demo files are never sent to the server.{" "}
          <Link href="/sign-in" className="text-button" data-testid="link-upload-sign-in">Sign in</Link>
        </div>
      ) : reviewItem?.extraction && reviewIndex != null ? (
        <>
          <div className="course-row" style={{ marginBottom: 12 }}>
            <FileText size={15} color="#6758E8"/>
            <div className="course-name">{reviewItem.file.name}<div className="course-code">Syllabus {reviewIndex + 1} of {items.length}</div></div>
            <button className="text-button" type="button" onClick={() => setReviewIndex(null)} data-testid="button-back-to-upload-list">All files</button>
          </div>
          <div className="form-field" style={{ marginBottom: 13 }}>
            <label htmlFor="syllabus-course">Update an existing course or create a new one</label>
            <select
              id="syllabus-course"
              className="field-select"
              value={reviewItem.courseId}
              onChange={(event) => setItems((current) => current.map((item, index) =>
                index === reviewIndex ? { ...item, courseId: event.target.value } : item,
              ))}
              data-testid="select-existing-course"
            >
              <option value="">Create a course from this syllabus</option>
              {state.courses.map((course) => <option key={course.id} value={course.id}>{course.code} · {course.name}</option>)}
            </select>
          </div>
          {reviewItem.courseId&&<div className="notice" style={{marginBottom:12}}><strong>Preserve assignment history</strong><p className="card-caption">For renamed or repeated assignments, choose the existing item to retain grades and milestones. Unmatched syllabus items may be removed; review the comparison before approval.</p>{reviewItem.extraction.assignments.map((assignment,index)=><div className="form-field" key={index}><label htmlFor={`match-${index}`}>{assignment.title} · {assignment.dueDate||"no date"}</label><select id={`match-${index}`} className="field-select" value={reviewItem.matches?.[index]??""} onChange={e=>{const value=e.target.value;setItems(current=>current.map((item,i)=>i===reviewIndex?{...item,matches:{...item.matches,[index]:value}}:item));}}><option value="">Automatic match</option><option value="new">New assignment</option>{state.assignments.filter(a=>a.courseId===reviewItem.courseId).map(a=><option key={a.id} value={a.id}>{a.title} · {a.dueDate||"no date"}</option>)}</select></div>)}</div>}
          <SyllabusChangeSummary state={state} courseId={reviewItem.courseId} extraction={reviewItem.extraction} matches={reviewItem.matches}/>
          <ExtractionReview
            extraction={reviewItem.extraction}
            onChange={updateReview}
            onApprove={approveCurrent}
            onBack={() => setReviewIndex(null)}
            approveLabel="Approve changes & continue"
            blocked={syllabusMatches(state,reviewItem.courseId,reviewItem.extraction,reviewItem.matches).some(m=>m.ambiguous)}
          />
        </>
      ) : (
        <>
          <label
            className={`card ${dragging ? "dragging" : ""}`}
            style={{ display: "grid", placeItems: "center", gap: 8, textAlign: "center", cursor: "pointer", borderStyle: "dashed", marginBottom: 12 }}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files); }}
            data-testid="dropzone-syllabus"
          >
            <Upload size={20} color="#6758E8"/>
            <span className="assignment-name">Drop PDFs here or choose files</span>
            <span className="card-caption">Up to five files, 10 MB each</span>
            <input
              className="field"
              type="file"
              accept="application/pdf,.pdf"
              multiple
              disabled={processing}
              onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.currentTarget.value = ""; }}
              data-testid="input-syllabus-pdf"
            />
          </label>
          {items.length > 0 && (
            <div className="card" style={{ padding: "8px 16px", marginBottom: 12 }}>
              {items.map((item, index) => (
                <div className="course-row" key={`${item.file.name}-${item.file.size}-${index}`} data-testid={`row-upload-file-${index}`}>
                  <FileText size={15} color="#6758E8"/>
                  <div className="course-name">{item.file.name}<div className="course-code">{(item.file.size / 1024 / 1024).toFixed(1)} MB · {statusLabel(item, index)}</div></div>
                  {item.status === "needs-review" && <button className="text-button" type="button" onClick={() => setReviewIndex(index)} data-testid={`button-review-file-${index}`}>Review</button>}
                  {item.status === "failed" && <span className="pill coral">Failed</span>}
                  {item.status === "approved" && <span className="pill lime">Saved</span>}
                  {item.status === "processing" && <span className="pill violet">Reading</span>}
                  {item.status !== "approved" && item.status !== "processing" && <button className="text-button" type="button" aria-label={`Remove ${item.file.name}`} disabled={processing} onClick={() => setItems((current) => current.filter((_, i) => i !== index))}><X size={14}/></button>}
                  {item.error && <span className="card-caption" role="alert">{item.error}</span>}
                </div>
              ))}
            </div>
          )}
          {processingIndex != null && <div className="notice" style={{ marginBottom: 12 }} data-testid="status-extraction-loading">Reading syllabus {processingIndex + 1} of {items.length} for reviewable course details…</div>}
          {error && <div className="notice coral" style={{ marginBottom: 12 }} role="alert" data-testid="status-extraction-error">{error}</div>}
          <div className="tool-row" style={{ justifyContent: "flex-end", marginTop: 18 }}>
            <button className="quiet-button" type="button" onClick={onClose} data-testid="button-cancel-upload">Cancel</button>
            {items.some((item) => item.status === "needs-review") && (
              <button className="quiet-button" type="button" onClick={() => setReviewIndex(items.findIndex((item) => item.status === "needs-review"))} data-testid="button-open-review">Review extracted data</button>
            )}
            <button type="button" className="primary-button" disabled={!items.length || processing || items.every((item) => item.status === "approved" || item.extraction)} onClick={() => void runExtraction()} data-testid="button-extract-syllabus">
              <Check size={14}/>{items.some((item) => item.status === "failed") ? "Retry failed files" : `Extract ${items.length || ""} ${items.length === 1 ? "syllabus" : "syllabi"}`}
            </button>
          </div>
        </>
      )}
    </UploadModal>
  );
}

function SyllabusChangeSummary({ state, courseId, extraction, matches }: {
  state: SemesterState;
  courseId: string;
  extraction: SyllabusExtraction;
  matches?:AssignmentMatches;
}) {
  const changes = getSyllabusChanges(state, courseId, extraction,matches);
  return (
    <div className="notice" style={{ marginBottom: 14 }} data-testid="panel-syllabus-changes">
      <strong>{courseId ? "Changes to review" : "New course details"}</strong>
      {changes.length ? (
        <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
          {changes.map((change, index) => (
            <li key={`${change.kind}-${change.title}-${index}`}>
              <b>{change.kind}:</b> {change.title} — {change.detail}
            </li>
          ))}
        </ul>
      ) : (
        <div style={{ marginTop: 5 }}>No assignment changes were detected. The reviewed syllabus version will still be kept.</div>
      )}
      <div style={{ marginTop: 7 }}>Course details, assignment changes, and policy-note changes below are a preview only. Nothing is saved until you approve. Omitted syllabus-linked assignment records are removed when approved; completed sessions remain in history and remaining planned sessions are skipped.</div>
    </div>
  );
}

function ExtractionReview({ extraction, onChange, onApprove, onBack, approveLabel, blocked }: {
  extraction: SyllabusExtraction;
  onChange: (extraction: SyllabusExtraction) => void;
  onApprove: () => void;
  onBack: () => void;
  approveLabel: string;
  blocked?:boolean;
}) {
  const updateCourse = (key: keyof SyllabusExtraction["course"], value: string) =>
    onChange({ ...extraction, course: { ...extraction.course, [key]: value } });
  const updateAssignment = (index: number, key: string, value: string) =>
    onChange({
      ...extraction,
      assignments: extraction.assignments.map((assignment, i) =>
        i === index
          ? { ...assignment, [key]: ["gradeWeight", "estimatedHours", "sourcePage"].includes(key) ? value === "" ? null : Number(value) : value }
          : assignment,
      ),
    });
  const updatePolicy = (index: number, key: "topic" | "text" | "page", value: string) =>
    onChange({
      ...extraction,
      policyNotes: extraction.policyNotes.map((note, i) =>
        i === index ? { ...note, [key]: key === "page" ? value === "" ? null : Number(value) : value } : note,
      ),
    });

  return (
    <div>
      <div className="notice" style={{ marginBottom: 15 }} data-testid="notice-review-extraction">
        Check the source document before approving. Dates and weights are never filled in when the syllabus is unclear.
      </div>
      {extraction.ambiguities.length > 0 && (
        <div className="notice coral" style={{ marginBottom: 14 }} data-testid="list-extraction-ambiguities">
          <strong>Needs a closer look</strong>
          <ul style={{ margin: "6px 0 0", paddingLeft: 19 }}>
            {extraction.ambiguities.map((ambiguity, index) => <li key={index}>{ambiguity}</li>)}
          </ul>
        </div>
      )}
      <div className="form-grid">
        <div className="form-field"><label>Course name</label><input className="field" value={extraction.course.name} onChange={(event) => updateCourse("name", event.target.value)} data-testid="input-review-course-name"/></div>
        <div className="form-field"><label>Course code</label><input className="field" value={extraction.course.code} onChange={(event) => updateCourse("code", event.target.value)} data-testid="input-review-course-code"/></div>
        <div className="form-field"><label>Instructor</label><input className="field" value={extraction.course.instructor || ""} onChange={(event) => updateCourse("instructor", event.target.value)} data-testid="input-review-instructor"/></div>
        <div className="form-field"><label>Course description</label><input className="field" value={extraction.course.description || ""} onChange={(event) => updateCourse("description", event.target.value)} data-testid="input-review-description"/></div>
        <div className="form-field"><label>Semester starts</label><input className="field" type="date" value={extraction.course.semesterStart || ""} onChange={(event) => updateCourse("semesterStart", event.target.value)} data-testid="input-review-semester-start"/></div>
        <div className="form-field"><label>Semester ends</label><input className="field" type="date" value={extraction.course.semesterEnd || ""} onChange={(event) => updateCourse("semesterEnd", event.target.value)} data-testid="input-review-semester-end"/></div>
      </div>
      {extraction.ambiguities.length > 0 && (
        <>
          <div className="section-row"><h2>Ambiguities to resolve</h2></div>
          {extraction.ambiguities.map((ambiguity, index) => (
            <div className="form-field" key={index} style={{ marginBottom: 8 }}>
              <label htmlFor={`ambiguity-${index}`}>Review note {index + 1}</label>
              <textarea id={`ambiguity-${index}`} className="field-textarea" value={ambiguity} onChange={(event) => onChange({ ...extraction, ambiguities: extraction.ambiguities.map((item, i) => i === index ? event.target.value : item) })} data-testid={`input-extraction-ambiguity-${index}`}/>
            </div>
          ))}
        </>
      )}
      <div className="section-row"><h2>Assignments ({extraction.assignments.length})</h2></div>
      {extraction.assignments.map((assignment, index) => (
        <div className="card" key={index} style={{ padding: 13, marginBottom: 9 }} data-testid={`card-extracted-assignment-${index}`}>
          <div className="form-grid">
            <div className="form-field full"><label>Title</label><input className="field" value={assignment.title} onChange={(event) => updateAssignment(index, "title", event.target.value)} data-testid={`input-extracted-title-${index}`}/></div>
            <div className="form-field"><label>Type</label><select className="field-select" value={assignment.type} onChange={(event) => updateAssignment(index, "type", event.target.value)} data-testid={`select-extracted-type-${index}`}>{["exam", "quiz", "project", "paper", "homework", "presentation", "other"].map((type) => <option key={type}>{type}</option>)}</select></div>
            <div className="form-field"><label>Due date</label><input className="field" type="date" value={assignment.dueDate || ""} onChange={(event) => updateAssignment(index, "dueDate", event.target.value)} data-testid={`input-extracted-date-${index}`}/></div>
            <div className="form-field"><label>Due time</label><input className="field" type="time" value={assignment.dueTime || ""} onChange={(event) => updateAssignment(index, "dueTime", event.target.value)} data-testid={`input-extracted-time-${index}`}/></div>
            <div className="form-field"><label>Weight (%)</label><input className="field" type="number" min="0" max="100" value={assignment.gradeWeight ?? ""} onChange={(event) => updateAssignment(index, "gradeWeight", event.target.value)} data-testid={`input-extracted-weight-${index}`}/></div>
            <div className="form-field"><label>Estimated hours</label><input className="field" type="number" min="0" value={assignment.estimatedHours ?? ""} onChange={(event) => updateAssignment(index, "estimatedHours", event.target.value)} data-testid={`input-extracted-hours-${index}`}/></div>
            <div className="form-field"><label>Source page</label><input className="field" type="number" min="1" value={assignment.sourcePage ?? ""} onChange={(event) => updateAssignment(index, "sourcePage", event.target.value)} data-testid={`input-extracted-page-${index}`}/></div>
            <div className="form-field full"><label>Description</label><textarea className="field-textarea" value={assignment.description || ""} onChange={(event) => updateAssignment(index, "description", event.target.value)} data-testid={`input-extracted-description-${index}`}/></div>
          </div>
        </div>
      ))}
      {extraction.policyNotes.length > 0 && (
        <>
          <div className="section-row"><h2>Policy notes</h2></div>
          {extraction.policyNotes.map((note, index) => (
            <div className="card" key={index} style={{ padding: 13, marginBottom: 8 }} data-testid={`card-extracted-policy-${index}`}>
              <div className="form-grid">
                <div className="form-field"><label>Topic</label><input className="field" value={note.topic} onChange={(event) => updatePolicy(index, "topic", event.target.value)} data-testid={`input-policy-topic-${index}`}/></div>
                <div className="form-field"><label>Source page</label><input className="field" type="number" min="1" value={note.page ?? ""} onChange={(event) => updatePolicy(index, "page", event.target.value)} data-testid={`input-policy-page-${index}`}/></div>
                <div className="form-field full"><label>Policy detail</label><textarea className="field-textarea" value={note.text} onChange={(event) => updatePolicy(index, "text", event.target.value)} data-testid={`input-policy-text-${index}`}/></div>
              </div>
            </div>
          ))}
        </>
      )}
      <div className="tool-row" style={{ justifyContent: "space-between", marginTop: 17 }}>
        <button type="button" className="quiet-button" onClick={onBack} data-testid="button-back-to-upload">Back</button>
        <button type="button" className="primary-button" disabled={blocked||!extraction.course.name.trim()} onClick={onApprove} data-testid="button-approve-extraction">
          <Check size={15}/>{approveLabel}
        </button>
      </div>
    </div>
  );
}
