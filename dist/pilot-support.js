import { rawPatients } from "./pilot-data.js";
import { readNote } from "./pilot-reader.js";
import { noteLabels, patientLabels } from "./pilot-labels.js";

const TYPES = ["transportation", "cost", "food", "health_literacy"];
const flattenNotes = (patients) =>
  patients.flatMap((patient) =>
    patient.notes.map((note) => ({ ...note, patientId: patient.id })),
  );
const ratio = (a, b) => (b ? a / b : 0);
const metrics = (value) => ({
  ...value,
  precision: ratio(value.tp, value.tp + value.fp),
  recall: ratio(value.tp, value.tp + value.fn),
});

/** Labels belong exclusively to evaluation and search scoring; never to graph construction. */
export function evaluateNotes(patients = rawPatients) {
  const expected = new Map(noteLabels.map((label) => [label.noteId, label]));
  const counts = Object.fromEntries(
    TYPES.map((type) => [type, { tp: 0, fp: 0, fn: 0 }]),
  );
  const falsePositives = [],
    falseNegatives = [];
  let notesRead = 0,
    reportedEdges = 0,
    rejectedSentences = 0;
  for (const note of flattenNotes(patients)) {
    const truth = expected.get(note.id);
    if (!truth) throw new Error(`Missing evaluation label for ${note.id}`);
    const reading = readNote(note);
    const predictions = new Map(
      reading.assertions
        .filter((a) => a.status === "active")
        .map((a) => [a.type, a]),
    );
    notesRead++;
    reportedEdges += predictions.size;
    rejectedSentences += reading.sentences.filter(
      (sentence) =>
        !sentence.assertions?.some((a) => a.status === "active") &&
        Object.values(sentence.scores || {}).some((score) => score > 0),
    ).length;
    for (const type of TYPES) {
      const actual = truth.expectedActiveTypes.includes(type),
        predicted = predictions.has(type);
      if (actual && predicted) counts[type].tp++;
      if (!actual && predicted) {
        counts[type].fp++;
        falsePositives.push({
          noteId: note.id,
          patientId: note.patientId,
          type,
          note,
          prediction: predictions.get(type),
          expected: truth,
        });
      }
      if (actual && !predicted) {
        counts[type].fn++;
        falseNegatives.push({
          noteId: note.id,
          patientId: note.patientId,
          type,
          note,
          prediction: null,
          expected: truth,
        });
      }
    }
  }
  const overall = metrics(
    Object.values(counts).reduce(
      (sum, row) => ({
        tp: sum.tp + row.tp,
        fp: sum.fp + row.fp,
        fn: sum.fn + row.fn,
      }),
      { tp: 0, fp: 0, fn: 0 },
    ),
  );
  return {
    overall,
    byType: Object.fromEntries(
      TYPES.map((type) => [type, metrics(counts[type])]),
    ),
    falsePositives,
    falseNegatives,
    notesRead,
    reportedEdges,
    rejectedSentences,
  };
}

export function groundTruthIds(questionId = "main") {
  const labels = new Map(
    patientLabels.map((label) => [label.patientId, label]),
  );
  const noteTruth = new Map(noteLabels.map((label) => [label.noteId, label]));
  const day = (date) =>
    Math.floor(
      (Date.parse("2026-10-10T12:00:00Z") -
        Date.parse(`${date.slice(0, 10)}T12:00:00Z`)) /
        86400000,
    );
  const needsGap = ![
    "all",
    "no-pickup",
    "cost",
    "return-risk",
    "units",
    "before-discharge",
    "ed-returns",
  ].includes(questionId);
  return new Set(
    rawPatients
      .filter((patient) => {
        if (questionId === "all") return true;
        const label = labels.get(patient.id);
        if (
          !label ||
          !patient.admission.diabetesRelated ||
          (needsGap && !label.openFollowUpGap)
        )
          return false;
        const types = label.trueBarrierTypes;
        const missedPickup = patient.medications.some(
          (m) => m.newStart && !m.pickedUp,
        );
        if (questionId === "standard") return !types.length;
        if (questionId === "no-pickup") return missedPickup;
        if (questionId === "ed-returns")
          return patient.appointments.some(
            (a) =>
              ["no-show", "no_show"].includes(a.status) &&
              patient.emergencyVisits.some((visit) => visit.date > a.date),
          );
        if (!types.length) return false;
        const type = questionId.replaceAll("-", "_");
        if (TYPES.includes(type))
          return (
            types.includes(type) &&
            (type !== "cost" ||
              patient.medications.some(
                (m) => m.newStart && m.isInsulin && !m.pickedUp,
              ))
          );
        if (questionId === "return-risk")
          return (
            patient.labs.some(
              (row) => row.code === "4548-4" && row.value > 9,
            ) &&
            !patient.appointments.some((row) => row.status === "completed") &&
            patient.medications.some(
              (row) => row.newStart && row.isInsulin && !row.pickedUp,
            )
          );
        if (questionId === "within30")
          return day(patient.admission.dischargeDate) < 30;
        if (questionId === "dual") return types.length > 1;
        if (questionId === "uncoded") return !patient.socialNeeds?.length;
        if (questionId === "before-discharge")
          return patient.notes.some(
            (note) =>
              !note.action_recorded &&
              !note.actionRecorded &&
              (note.written_datetime || note.date) <
                patient.admission.discharge_datetime &&
              noteTruth
                .get(note.id)
                ?.expectedActiveTypes.some((type) => types.includes(type)),
          );
        return true;
      })
      .map((patient) => patient.id),
  );
}

const STOP = new Set(
  "a an and are as at be been by for from had has have he her his i in is it its me my of on or our she that the their them they this to was we were what which who will with you your patients patient discharged admission diabetes related documented barrier barriers open follow up gap right each act".split(
    " ",
  ),
);
const EXPANSIONS = {
  transportation: [
    "transportation",
    "transport",
    "ride",
    "rides",
    "bus",
    "daughter",
    "appointment",
  ],
  cost: ["cost", "afford", "copay", "expensive", "pay", "money", "insulin"],
  food: ["food", "meals", "groceries", "cupboards", "hungry", "pantry"],
  health_literacy: [
    "understand",
    "instructions",
    "dose",
    "dosing",
    "reading",
    "teach",
    "literacy",
  ],
};
const tokenize = (text) =>
  (
    String(text)
      .toLowerCase()
      .match(/[a-z][a-z0-9]+/g) || []
  ).filter((word) => !STOP.has(word));
function queryTokens(question) {
  const text = question.toLowerCase();
  const types = TYPES.filter((type) =>
    new RegExp(
      type === "health_literacy"
        ? "literacy|instructions|understand|dose"
        : type === "transportation"
          ? "transport|ride|bus"
          : type === "cost"
            ? "cost|afford|copay"
            : "food|meal|grocer",
    ).test(text),
  );
  const broad = /barrier|reason|help|action|return/.test(text);
  return [
    ...tokenize(question),
    ...(types.length ? types : broad ? TYPES : []).flatMap(
      (type) => EXPANSIONS[type],
    ),
  ];
}
function vector(tokens, idf) {
  const frequencies = new Map();
  for (const token of tokens)
    if (idf.has(token))
      frequencies.set(token, (frequencies.get(token) || 0) + 1);
  const values = new Map(
    [...frequencies].map(([token, count]) => [
      token,
      (1 + Math.log(count)) * idf.get(token),
    ]),
  );
  const norm =
    Math.sqrt([...values.values()].reduce((sum, n) => sum + n * n, 0)) || 1;
  return new Map([...values].map(([token, value]) => [token, value / norm]));
}
const dot = (a, b) =>
  [...a].reduce((sum, [key, value]) => sum + value * (b.get(key) || 0), 0);

/** Centered PCA of actual TF-IDF vectors, using covariance multiplication and power iteration. */
function pca(vectors, vocabulary) {
  const indices = new Map(vocabulary.map((word, index) => [word, index]));
  const rows = vectors.map((row) =>
    [...row].map(([word, value]) => [indices.get(word), value]),
  );
  const dimensions = vocabulary.length,
    n = rows.length;
  const mean = new Float64Array(dimensions);
  for (const row of rows)
    for (const [index, value] of row) mean[index] += value / n;
  const multiply = (axis) => {
    const meanProjection = axis.reduce(
      (sum, value, i) => sum + value * mean[i],
      0,
    );
    const projections = rows.map(
      (row) =>
        row.reduce((sum, [index, value]) => sum + value * axis[index], 0) -
        meanProjection,
    );
    const output = new Float64Array(dimensions);
    let projectionSum = 0;
    rows.forEach((row, i) => {
      projectionSum += projections[i];
      for (const [index, value] of row) output[index] += value * projections[i];
    });
    for (let i = 0; i < dimensions; i++) output[i] -= mean[i] * projectionSum;
    return output;
  };
  const axes = [];
  for (let component = 0; component < 2; component++) {
    let axis = Float64Array.from({ length: dimensions }, (_, i) =>
      Math.sin((i + 1) * (component + 1.37)),
    );
    for (let iteration = 0; iteration < 70; iteration++) {
      const next = multiply(axis);
      for (const previous of axes) {
        const projection = next.reduce(
          (sum, value, i) => sum + value * previous[i],
          0,
        );
        for (let i = 0; i < dimensions; i++)
          next[i] -= projection * previous[i];
      }
      const norm =
        Math.sqrt(next.reduce((sum, value) => sum + value * value, 0)) || 1;
      axis = next.map((value) => value / norm);
    }
    axes.push(axis);
  }
  const projectRow = (row) =>
    axes.map(
      (axis) =>
        row.reduce((sum, [index, value]) => sum + value * axis[index], 0) -
        axis.reduce((sum, value, i) => sum + value * mean[i], 0),
    );
  return {
    coordinates: rows.map(projectRow),
    project: (vector) =>
      projectRow(
        [...vector]
          .map(([word, value]) => [indices.get(word), value])
          .filter(([index]) => index !== undefined),
      ),
  };
}

export function buildSearchIndex(notes = flattenNotes(rawPatients)) {
  const documents = notes.map((note) => tokenize(note.text));
  const documentFrequency = new Map();
  for (const tokens of documents)
    for (const token of new Set(tokens))
      documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1);
  const idf = new Map(
    [...documentFrequency]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([word, count]) => [
        word,
        Math.log((1 + notes.length) / (1 + count)) + 1,
      ]),
  );
  const vectors = documents.map((tokens) => vector(tokens, idf));
  const projection = pca(vectors, [...idf.keys()]);
  const coordinates = projection.coordinates;
  const points = notes.map((note, index) => ({
    noteId: note.id,
    patientId: note.patientId,
    x: coordinates[index][0],
    y: coordinates[index][1],
  }));
  const labels = new Map(noteLabels.map((label) => [label.noteId, label]));
  const patientTruth = new Map(
    patientLabels.map((label) => [label.patientId, label]),
  );
  return {
    points,
    notes,
    search(question, k = 5, truthIds = groundTruthIds()) {
      const query = vector(queryTokens(question), idf);
      const [x, y] = projection.project(query);
      const limit = Math.max(5, Math.min(100, Math.round(Number(k) || 5)));
      const results = notes
        .map((note, i) => ({
          noteId: note.id,
          patientId: note.patientId,
          note,
          score: dot(query, vectors[i]),
          x: points[i].x,
          y: points[i].y,
        }))
        .sort((a, b) => b.score - a.score || a.noteId.localeCompare(b.noteId))
        .slice(0, limit)
        .map((row) => {
          const label = labels.get(row.noteId),
            patient = patientTruth.get(row.patientId),
            isCorrect = truthIds.has(row.patientId);
          const reason = isCorrect
            ? "Patient meets the labeled question criteria."
            : !patient?.openFollowUpGap
              ? "No open follow-up gap."
              : label?.category === "negation"
                ? "This sentence says the problem is absent."
                : label?.category === "resolved" ||
                    label?.category === "historical"
                  ? "This problem has already ended."
                  : label?.category === "third_party"
                    ? "This describes someone else."
                    : label?.category === "clinical"
                      ? "A clinical instruction, not a social need."
                      : "Patient does not meet all question criteria.";
          return { ...row, isCorrect, reason };
        });
      const patients = new Set(results.map((row) => row.patientId));
      const right = [...patients].filter((id) => truthIds.has(id)).length;
      return {
        results,
        points,
        queryPoint: { x, y },
        right,
        wrong: patients.size - right,
        uniquePatients: patients.size,
        totalTruth: truthIds.size,
        neverRead: notes.length - results.length,
        totalNotes: notes.length,
        k: limit,
      };
    },
  };
}

export function matchQuestion(text, plans) {
  const normalized = String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const exact = plans.find(
    (plan) =>
      plan.question
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim() === normalized,
  );
  if (exact) return { plan: exact, exact: true, similarity: 1 };
  const words = new Set(tokenize(text));
  const ranked = plans
    .map((plan) => {
      const target = new Set(
        tokenize(`${plan.question} ${plan.keywords || ""}`),
      );
      const intersection = [...words].filter((word) => target.has(word)).length;
      return {
        plan,
        exact: false,
        similarity:
          intersection / Math.sqrt(Math.max(1, words.size * target.size)),
      };
    })
    .sort((a, b) => b.similarity - a.similarity);
  return ranked[0];
}

export async function loadPrepared() {
  const [plans, explanations, reading] = await Promise.all(
    ["plans", "explanations", "reading"].map(async (name) => {
      const response = await fetch(`/prepared/${name}.json`);
      if (!response.ok)
        throw new Error(`Unable to load the prepared ${name}. Please reload.`);
      return response.json();
    }),
  );
  return { plans, explanations, reading };
}
