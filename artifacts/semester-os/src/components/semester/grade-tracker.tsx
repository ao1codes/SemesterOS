import { useEffect, useState, type FormEvent } from "react";
import type { Assignment, Course, CourseGradingMode, GradeCategory } from "@workspace/api-client-react";
import { calculateCourseGrade, calculateRequiredAverage } from "@/lib/grade-calculations";

type GradeTrackerProps = {
  course: Course;
  assignments: Assignment[];
  onSaveCourse: (patch: Partial<Course>) => void;
};

export function GradeTracker({ course, assignments, onSaveCourse }: GradeTrackerProps) {
  const [target, setTarget] = useState(course.targetFinalGrade == null ? "" : String(course.targetFinalGrade));
  const [mode, setMode] = useState<CourseGradingMode>(course.gradingMode || "assignment_weighted");
  const [categories, setCategories] = useState<GradeCategory[]>(course.gradeCategories || []);
  const [saved, setSaved] = useState(false);
  const categoriesKey=JSON.stringify(course.gradeCategories||[]);

  useEffect(() => {
    setTarget(course.targetFinalGrade == null ? "" : String(course.targetFinalGrade));
    setMode(course.gradingMode || "assignment_weighted");
    setCategories(course.gradeCategories || []);
  }, [course.id, course.targetFinalGrade, course.gradingMode, categoriesKey]);

  const calculation = calculateCourseGrade(assignments, categories, mode);
  const targetValue = target === "" ? null : Number(target);
  const requiredAverage = calculateRequiredAverage(calculation, targetValue);
  const categoryWeightTotal = categories.reduce((sum, category) => sum + category.weight, 0);

  const save = (event: FormEvent) => {
    event.preventDefault();
    const value = target.trim() === "" ? null : Number(target);
    if (value != null && (!Number.isFinite(value) || value < 0 || value > 100)) return;
    onSaveCourse({targetFinalGrade:value,gradingMode:mode,gradeCategories:categories});
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2200);
  };

  return (
    <section className="card" data-testid={`panel-grade-tracker-${course.id}`}>
      <div className="eyebrow">Course grade tracker</div>
      <h2 className="card-title" style={{ marginTop: 7 }}>{course.name}</h2>
      <p className="card-caption" style={{ lineHeight: 1.6 }}>
        {mode==="assignment_weighted"
          ? "Assignment-weighted mode uses the recorded grade percentages and course weights."
          : mode==="points_based"
            ? "Points mode uses only items with both earned and possible points entered."
            : "Category mode combines course category weights with assignment weights inside each category."}
      </p>
      <div className="form-grid" style={{marginTop:14}}>
        <div className="form-field"><label htmlFor={`grading-mode-${course.id}`}>Grading mode</label><select id={`grading-mode-${course.id}`} className="field-select" value={mode} onChange={event=>setMode(event.target.value as CourseGradingMode)} data-testid={`select-grading-mode-${course.id}`}><option value="assignment_weighted">Assignment weighted (default)</option><option value="points_based">Points based</option><option value="category_weighted">Category weighted</option></select></div>
        {mode==="category_weighted"&&<div className="form-field"><label>Grade categories and course weights (%)</label><div style={{display:"grid",gap:7}}>{categories.map((category,index)=><div className="tool-row" key={category.id}><input className="field" aria-label={`Category ${index+1} name`} value={category.name} onChange={e=>setCategories(items=>items.map(c=>c.id===category.id?{...c,name:e.target.value}:c))} data-testid={`input-grade-category-name-${category.id}`}/><input className="field" type="number" min="0" max="100" aria-label={`Category ${category.name} weight`} value={category.weight} onChange={e=>setCategories(items=>items.map(c=>c.id===category.id?{...c,weight:Number(e.target.value)}:c))} data-testid={`input-grade-category-weight-${category.id}`}/><button type="button" className="text-button" aria-label={`Remove category ${category.name}`} onClick={()=>setCategories(items=>items.filter(c=>c.id!==category.id))} data-testid={`button-remove-grade-category-${category.id}`}>Remove</button></div>)}<button type="button" className="quiet-button" onClick={()=>setCategories(items=>[...items,{id:`category-${crypto.randomUUID()}`,name:"New category",weight:0}])} data-testid={`button-add-grade-category-${course.id}`}>Add category</button><span className="card-caption">Category weights currently total {categoryWeightTotal.toFixed(1)}%. Each category’s assignment weights must also total 100% for a target estimate.</span></div></div>}
      </div>
      <div className="grid-two" style={{ marginTop: 18 }}>
        <div>
          <div className="eyebrow">Current grade on recorded work</div>
          <div className="stat-value" style={{ fontSize: 22, marginTop: 5 }}>
            {calculation.currentGrade == null ? "—" : `${calculation.currentGrade.toFixed(1)}%`}
          </div>
        </div>
        <div>
          <div className="eyebrow">{mode==="points_based"?"Recorded points":"Graded course weight"}</div>
          <div className="stat-value" style={{ fontSize: 22, marginTop: 5 }}>
            {mode==="points_based"
              ? `${calculation.pointsEarned} / ${calculation.recordedPossiblePoints}`
              : `${calculation.gradedWeight.toFixed(1)}%`}
          </div>
        </div>
      </div>
      <p className="card-caption" style={{ marginTop: 10 }}>
        {mode==="points_based"
          ? `${calculation.remainingPossiblePoints == null
              ? "Enter possible points for every assignment to estimate a final target."
              : `${calculation.remainingPossiblePoints} possible points remain without a recorded grade.`} Current grade includes only complete point records.`
          : `${calculation.remainingWeight.toFixed(1)}% of the course weight is not represented by entered grades. Missing weights are never inferred.`}
      </p>
      <form onSubmit={save} className="tool-row" style={{ marginTop: 17, alignItems: "flex-end" }}>
        <div className="form-field" style={{ flex: "1 1 150px" }}>
          <label htmlFor={`target-grade-${course.id}`}>Target final grade (%)</label>
          <input
            id={`target-grade-${course.id}`}
            className="field"
            type="number"
            min="0"
            max="100"
            step="0.1"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            placeholder="Set a target"
            data-testid={`input-target-grade-${course.id}`}
          />
        </div>
        <button className="quiet-button" type="submit" data-testid={`button-save-target-grade-${course.id}`}>
          {saved ? "Saved" : "Save target"}
        </button>
      </form>
      {targetValue != null && (
        <div className="notice" style={{ marginTop: 13 }} data-testid={`text-required-grade-${course.id}`}>
          {requiredAverage == null
            ? mode==="points_based"
              ? calculation.pointStructureComplete
                ? "All possible points have recorded grades, so there is no remaining-point estimate."
                : "A target average is not calculated until possible points are entered for every assignment."
              : calculation.weightStructureComplete
                ? "There is no ungraded course weight left to calculate a required average."
                : mode==="category_weighted"
                  ? "A target average needs category weights totaling 100% and assignment weights totaling 100% within each category."
                  : "A target average needs assignment weights totaling 100%; missing weights are not inferred."
            : requiredAverage <= 0
              ? `You have already met the ${targetValue.toFixed(1)}% target based on entered grades.`
              : requiredAverage > 100
                ? `A ${targetValue.toFixed(1)}% final target would require more than 100% on the remaining work.`
                : mode==="points_based"
                  ? `You would need an average of ${requiredAverage.toFixed(1)}% on the remaining ${calculation.remainingPossiblePoints} possible points.`
                  : `You would need an average of ${requiredAverage.toFixed(1)}% on the remaining ${calculation.remainingWeight.toFixed(1)}% of course weight to reach your target.`}
          {" "}Missing weights and points are never inferred.
        </div>
      )}
    </section>
  );
}
