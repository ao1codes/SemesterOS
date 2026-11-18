import type {
  Assignment,
  Course,
  Notification,
  SemesterState,
  SyllabusExtraction,
} from "@workspace/api-client-react";

export type SyllabusChange = {
  kind: "New" | "Changed" | "Removed";
  title: string;
  detail: string;
};

export function normalizedTitle(value: string) {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
export type AssignmentMatches = Record<number,string>;
export function syllabusMatches(state:SemesterState,courseId:string,extraction:SyllabusExtraction,choices:AssignmentMatches={}) {
  const used=new Set<string>();
  return extraction.assignments.map((next,index)=>{
    const pool=state.assignments.filter(a=>a.courseId===courseId&&!used.has(a.id));
    const explicit=choices[index];
    const candidates=pool.filter(a=>normalizedTitle(a.title)===normalizedTitle(next.title));
    const exact=candidates.filter(a=>(a.dueDate??null)===(next.dueDate??null)&&a.type===next.type);
    const matched=explicit==="new"?undefined:explicit?pool.find(a=>a.id===explicit):exact.length===1?exact[0]:candidates.length===1?candidates[0]:undefined;
    if(matched)used.add(matched.id);
    return {matched,ambiguous:(!explicit&&!matched&&candidates.length>1)||Boolean(explicit&&explicit!=="new"&&!matched)};
  });
}

export function getSyllabusChanges(
  state: SemesterState,
  courseId: string,
  extraction: SyllabusExtraction,
  choices: AssignmentMatches = {},
): SyllabusChange[] {
  const current = state.assignments.filter((assignment) => assignment.courseId === courseId);
  const matchedIds=new Set(syllabusMatches(state,courseId,extraction,choices).flatMap(m=>m.matched?[m.matched.id]:[]));
  const changes: SyllabusChange[] = [];
  const existingCourse = state.courses.find((course) => course.id === courseId);
  if (existingCourse) {
    const effectiveInstructor = extraction.course.instructor || existingCourse.instructor || "";
    const effectiveDescription = extraction.course.description || existingCourse.description || "";
    const effectiveCode = extraction.course.code || existingCourse.code || "";
    const effectiveStart = extraction.course.semesterStart || existingCourse.semesterStart || state.preferences.semesterStart || "";
    const effectiveEnd = extraction.course.semesterEnd || existingCourse.semesterEnd || state.preferences.semesterEnd || "";
    for (const [label, oldValue, newValue] of [
      ["Name", existingCourse.name, extraction.course.name],
      ["Code", existingCourse.code, effectiveCode],
      ["Instructor", existingCourse.instructor || "", effectiveInstructor],
      ["Description", existingCourse.description || "", effectiveDescription],
      ["Semester start", existingCourse.semesterStart || "", effectiveStart],
      ["Semester end", existingCourse.semesterEnd || "", effectiveEnd],
    ]) {
      if (oldValue !== newValue) {
        changes.push({ kind: "Changed", title: `Course ${label}`, detail: `${oldValue || "not recorded"} → ${newValue || "not recorded"}` });
      }
    }
  } else {
    changes.push({ kind: "New", title: "Course information", detail: `${extraction.course.name} · ${extraction.course.code}` });
  }

  const matches=syllabusMatches(state,courseId,extraction,choices);
  for (const [index,next] of extraction.assignments.entries()) {
    const old = matches[index].matched;
    if(matches[index].ambiguous){changes.push({kind:"Changed",title:next.title,detail:"Ambiguous match: explicitly choose the existing assignment to preserve."});continue;}
    if (!old) {
      changes.push({ kind: "New", title: next.title, detail: "New assignment or assessment" });
      continue;
    }
    const differences: string[] = [];
    if ((old.dueDate ?? null) !== (next.dueDate ?? null)) differences.push(`due date: ${old.dueDate || "none"} → ${next.dueDate || "none"}`);
    if ((old.dueTime ?? null) !== (next.dueTime ?? null)) differences.push("due time");
    if ((old.gradeWeight ?? null) !== (next.gradeWeight ?? null)) differences.push("grade weight");
    if (old.type !== next.type) differences.push("type");
    if ((old.estimatedHours ?? null) !== (next.estimatedHours ?? null)) differences.push("estimated hours");
    if ((old.description ?? null) !== (next.description ?? null)) differences.push("description");
    if (differences.length) changes.push({ kind: "Changed", title: next.title, detail: differences.join(", ") });
  }

  const priorDocumentIds = new Set(
    state.documents.filter((document) => document.courseId === courseId).map((document) => document.id),
  );
  for (const old of current) {
    if (old.sourceDocumentId && priorDocumentIds.has(old.sourceDocumentId) && !matchedIds.has(old.id)) {
      changes.push({ kind: "Removed", title: old.title, detail: "No longer listed in the revised syllabus" });
    }
  }

  const priorDocument = state.documents
    .filter((document) => document.courseId === courseId)
    .sort((a, b) => b.version - a.version)[0];
  const oldPolicies = priorDocument?.policyNotes || [];
  const nextPolicyNames = new Set(extraction.policyNotes.map((note) => normalizedTitle(note.topic)));
  for (const next of extraction.policyNotes) {
    const old = oldPolicies.find((note) => normalizedTitle(note.topic) === normalizedTitle(next.topic));
    if (!old) {
      changes.push({ kind: "New", title: `Policy: ${next.topic}`, detail: `${next.text}${next.page ? ` · page ${next.page}` : ""}` });
      continue;
    }
    const fields: string[] = [];
    if (old.text !== next.text) fields.push(`text: ${old.text} → ${next.text}`);
    if ((old.page ?? null) !== (next.page ?? null)) fields.push(`source page: ${old.page ?? "none"} → ${next.page ?? "none"}`);
    if (fields.length) changes.push({ kind: "Changed", title: `Policy: ${next.topic}`, detail: fields.join("; ") });
  }
  for (const old of oldPolicies) {
    if (!nextPolicyNames.has(normalizedTitle(old.topic))) {
      changes.push({ kind: "Removed", title: `Policy: ${old.topic}`, detail: "No longer listed in the revised syllabus" });
    }
  }
  return changes;
}

export function applyApprovedSyllabus(
  state: SemesterState,
  input: { extraction: SyllabusExtraction; courseId: string; filename: string; matches?:AssignmentMatches },
  now = new Date(),
): SemesterState {
  const { extraction } = input;
  const suggestedCourse = state.courses.find(
    (course) => normalizedTitle(course.code) === normalizedTitle(extraction.course.code),
  );
  const courseId = input.courseId || suggestedCourse?.id || `course-${crypto.randomUUID()}`;
  const existingCourse = state.courses.find((course) => course.id === courseId);
  const palette = ["#6758E8", "#7B9B42", "#E67A66", "#5C9AC1"];
  const course: Course = {
    id: courseId,
    name: extraction.course.name,
    code: extraction.course.code || existingCourse?.code || "",
    instructor: extraction.course.instructor || existingCourse?.instructor || null,
    description: extraction.course.description || existingCourse?.description || null,
    color: existingCourse?.color || palette[state.courses.length % palette.length],
    targetFinalGrade: existingCourse?.targetFinalGrade ?? null,
    gradingMode: existingCourse?.gradingMode ?? "assignment_weighted",
    gradeCategories: existingCourse?.gradeCategories ?? [],
    semesterStart: extraction.course.semesterStart || existingCourse?.semesterStart || state.preferences.semesterStart || now.toISOString().slice(0, 10),
    semesterEnd: extraction.course.semesterEnd || existingCourse?.semesterEnd || state.preferences.semesterEnd || now.toISOString().slice(0, 10),
  };

  const priorDocumentIds = new Set(
    state.documents.filter((document) => document.courseId === courseId).map((document) => document.id),
  );
  const currentAssignments = state.assignments.filter((assignment) => assignment.courseId === courseId);
  const matching=syllabusMatches(state,courseId,extraction,input.matches);
  if(matching.some(m=>m.ambiguous))throw new Error("Resolve ambiguous assignment matches before approving.");
  const currentByTitle = new Map<string, Assignment>();
  for (const assignment of currentAssignments) {
    const key = normalizedTitle(assignment.title);
    if (key && !currentByTitle.has(key)) currentByTitle.set(key, assignment);
  }
  const uniqueExtraction: SyllabusExtraction["assignments"] = [];
  const seenTitles = new Set<string>();
  for (const assignment of extraction.assignments) {
    const key = `${normalizedTitle(assignment.title)}|${assignment.type}|${assignment.dueDate??""}`;
    if (key && !seenTitles.has(key)) {
      uniqueExtraction.push(assignment);
      seenTitles.add(key);
    }
  }
  const nextNames = new Set(uniqueExtraction.map((assignment) => normalizedTitle(assignment.title)));
  const preservedIds=new Set(matching.flatMap(m=>m.matched?[m.matched.id]:[]));
  const removedIds = new Set(
    currentAssignments
      .filter((assignment) =>
        assignment.sourceDocumentId &&
        priorDocumentIds.has(assignment.sourceDocumentId) &&
        !preservedIds.has(assignment.id)
      )
      .map((assignment) => assignment.id),
  );
  const documentId = `document-${crypto.randomUUID()}`;
  const version = Math.max(
    0,
    ...state.documents
      .filter((document) => document.courseId === courseId)
      .map((document) => document.version),
  ) + 1;
  const policyNotes = extraction.policyNotes.map((note) => ({
    id: `policy-${crypto.randomUUID()}`,
    ...note,
  }));
  const document = {
    id: documentId,
    courseId,
    filename: input.filename,
    uploadedAt: now.toISOString(),
    version,
    policyNotes,
  };

  let added = 0;
  let changed = 0;
  const matchedIds = new Set<string>();
  const changedIds = new Set<string>();
  const upsertedAssignments: Assignment[] = uniqueExtraction.map((next, index) => {
    const sourceIndex=extraction.assignments.indexOf(next);
    const candidate = matching[sourceIndex]?.matched;
    const existing = candidate && !matchedIds.has(candidate.id) ? candidate : undefined;
    const assignment: Assignment = {
      id: existing?.id || `assignment-${crypto.randomUUID()}-${index}`,
      courseId,
      title: next.title,
      type: next.type,
      dueDate: next.dueDate || null,
      dueTime: next.dueTime || null,
      gradeWeight: next.gradeWeight ?? null,
      estimatedHours: next.estimatedHours ?? null,
      description: next.description || null,
      status: existing?.status || "upcoming",
      gradeEarned: existing?.gradeEarned ?? null,
      gradeCategoryId: existing?.gradeCategoryId ?? null,
      pointsEarned: existing?.pointsEarned ?? null,
      pointsPossible: existing?.pointsPossible ?? null,
      sourceDocumentId: documentId,
      sourcePage: next.sourcePage ?? null,
      milestones: existing?.milestones || [],
    };
    if (existing) {
      matchedIds.add(existing.id);
      const isChanged =
        (existing.dueDate ?? null) !== assignment.dueDate ||
        (existing.dueTime ?? null) !== assignment.dueTime ||
        (existing.gradeWeight ?? null) !== assignment.gradeWeight ||
        existing.type !== assignment.type ||
        (existing.estimatedHours ?? null) !== assignment.estimatedHours ||
        (existing.description ?? null) !== assignment.description;
      if (isChanged) {
        changed += 1;
        changedIds.add(existing.id);
      }
    } else {
      added += 1;
    }
    return assignment;
  });

  const changesToNotify = added + changed + removedIds.size + getSyllabusChanges(state,courseId,extraction,input.matches).filter(c=>c.title.startsWith("Policy:")||c.title.startsWith("Course ")).length;
  const notification: Notification | null = changesToNotify &&
    (state.preferences.notificationCategories?.includes("syllabus") ?? true)
    ? {
        id: `syllabus-${documentId}`,
        category: "syllabus",
        title: "Syllabus update applied",
        message: `${course.code}: ${added} added, ${changed} changed, and ${removedIds.size} removed assignments; course and policy changes were applied as reviewed. Review the Study Planner to replace affected sessions and Calendar to review previously exported events. No external events were modified.`,
        createdAt: now.toISOString(),
        isRead: false,
        dismissed: false,
        snoozedUntil: null,
      }
    : null;

  return {
    ...state,
    courses: existingCourse
      ? state.courses.map((current) => current.id === courseId ? course : current)
      : [...state.courses, course],
    assignments: [
      ...state.assignments.filter((assignment) =>
        !removedIds.has(assignment.id) &&
        !matchedIds.has(assignment.id) &&
        !(
          assignment.courseId === courseId &&
          assignment.sourceDocumentId &&
          priorDocumentIds.has(assignment.sourceDocumentId) &&
          nextNames.has(normalizedTitle(assignment.title))
        )
      ),
      ...upsertedAssignments,
    ],
    sessions: state.sessions.map((session) =>
      session.assignmentId &&
      (removedIds.has(session.assignmentId) || changedIds.has(session.assignmentId)) &&
      session.status === "planned"
        ? { ...session, status: "skipped" as const }
        : session,
    ),
    documents: [
      ...state.documents,
      {
        ...document,
        snapshot: {
          course,
          assignments: upsertedAssignments,
          policyNotes,
          ambiguities: [...extraction.ambiguities],
        },
      },
    ],
    notifications: [
      ...state.notifications.map(n => {
        const affected=[...removedIds,...changedIds].some(id=>n.id.startsWith(`deadline-${id}-`));
        const affectedSession=state.sessions.some(s=>s.assignmentId&&([...removedIds,...changedIds].includes(s.assignmentId))&&n.id.startsWith(`study-session-${s.id}-`));
        return affected||affectedSession ? {...n,isRead:true,dismissed:true} : n;
      }),
      ...(notification?[notification]:[]),
    ],
  };
}
