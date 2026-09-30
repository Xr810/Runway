import { test } from "node:test";
import assert from "node:assert/strict";
import { builtinAssessmentSchema, groundAssessment } from "../../lib/builtin-assessment";
import { assessmentSchema, profileSchema, rubric } from "../../lib/enrichment-contract";
import { blankEntry, score, internshipValue } from "../../lib/model";

const factor = { score: 7, reason: "Supported by input", confidence: "medium", evidence: ["Provided evidence"] };
const output = { kind: "assessment", summary: "Summary", fit: factor, career: factor, outlook: factor, hardConstraints: [], missing: [] };
const input = { target: { kind: "job" as const, id: "test" }, name: "Intern", rubric,
  job: { ...blankEntry("job"), jd: "Firmware role" },
  profile: profileSchema.parse({ background: "Firmware experience", goals: "Embedded systems" }),
};
const sources = [{ title: "Official", url: "https://example.com", checkedAt: "2026-09-29T07:00:00.000Z" }];

test("builtin assessment accepts missing source timestamps and uses only server provenance", () => {
  for (const metadata of [{}, { model: "invented", sources: [{ title: "Fake", url: "https://fake.example" }] },
    { model: null, sources: [{ checkedAt: "invented date", url: "javascript:bad" }] }]) {
    const raw = builtinAssessmentSchema.parse({ ...output, ...metadata });
    const result = groundAssessment(raw, input, "configured-model", sources);
    assert.equal(result.model, "configured-model");
    assert.deepEqual(result.sources, sources);
    assert.equal(result.fit.score, 7);
    assert.equal(result.outlook.score, 7);
    assert(assessmentSchema.safeParse(result).success);
  }
});

test("provider schema keeps assessment content strict and final schema requires dated sources", () => {
  for (const invalid of [{ summary: "" }, { fit: { ...factor, score: 11 } }, { career: { ...factor, evidence: "unsupported" } }, { extra: true }]) {
    assert(!builtinAssessmentSchema.safeParse({ ...output, ...invalid }).success);
  }
  assert(!assessmentSchema.safeParse({ ...output, model: "m", sources: [{ title: "Missing date", url: "https://example.com" }] }).success);
  const raw = builtinAssessmentSchema.parse({ ...output, sources });
  const result = groundAssessment(raw, input, "m", []);
  assert.deepEqual(result.sources, []);
  assert.equal(result.outlook.score, null);
});

test("provider evidence objects are normalized into readable text", () => {
  const raw = builtinAssessmentSchema.parse({ ...output, fit: { ...factor, evidence: [{ text: "Python experience", source: "CV" }] } });
  assert.deepEqual(raw.fit.evidence, ["Python experience · CV"]);
  const result = groundAssessment(raw, input, "m", sources);
  assert.deepEqual(result.fit.evidence, ["Python experience · CV"]);
  assert(assessmentSchema.safeParse(result).success);
});

test("student evaluation weights have balanced, academic, internship and return-offer presets", () => {
  for (const preset of ["balanced","academic","internship","returnOffer"] as const) {
    const weights=profileSchema.parse({evaluationPreset:preset}).evaluationWeights;
    assert.equal(Object.values(weights).reduce((a,b)=>a+b,0),100);
  }
  assert.equal(profileSchema.parse({}).evaluationPreset,"balanced");
  assert(!profileSchema.safeParse({evaluationWeights:{fit:30,career:30,returnOffer:20,academic:10,outlook:5}}).success);
});

test("return offer and academic scores need their own evidence", () => {
  const raw=builtinAssessmentSchema.parse({...output,returnOffer:{...factor,evidence:[]},academic:factor});
  const result=groundAssessment(raw,input,"m",sources);
  assert.equal(result.returnOffer.score,null);
  assert.equal(result.academic.score,7);
});

test("composite score normalizes only evidenced dimensions using the chosen weights", () => {
  const entry={...blankEntry("job"),fit:8,career:6,outlook:4,returnOffer:null,academic:10};
  assert.equal(score(entry,{fit:20,career:20,returnOffer:40,academic:10,outlook:10}),7);
  assert.equal(internshipValue(entry),8);
});
