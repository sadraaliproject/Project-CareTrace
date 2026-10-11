import { readNote as readFrozenNote } from "../dist/pilot-reader.js";

// The guided story retains its original frozen reader and measured errors.
// This version is used only by the live workspace and is evaluated separately.
export const LIVE_READER_VERSION = "2026-10-10.2";

const typeMention = {
  transportation:
    /\b(?:transport(?:ation)?|rides?|bus|buses|vehicle|car|driver)\b/i,
  cost: /\b(?:costs?|copay|afford|financial|payment|budget|pay for)\b/i,
  food: /\b(?:food|groceries|meals?|pantry|cupboards?|hungry)\b/i,
  health_literacy:
    /\b(?:literacy|understand|understanding|confused|instructions?|dosing|teach.back)\b/i,
};

function clauseRanges(sentence) {
  const result = [];
  // A denial in one independent clause must not negate a different barrier.
  const separators =
    /;|\b(?:but|however|yet|whereas)\b|\band\b(?=\s+(?:(?:pt|patient|he|she)\s+)?(?:denies|reports|has\s+no|have\s+no|cannot\s+afford|can't\s+afford|no\s+(?:ride|transportation|cost|food)|now\s+has))/gi;
  let start = 0;
  for (const match of sentence.text.matchAll(separators)) {
    if (match.index > start) result.push([start, match.index]);
    start = match.index + match[0].length;
  }
  if (start < sentence.text.length) result.push([start, sentence.text.length]);
  return result
    .map(([from, to]) => {
      const raw = sentence.text.slice(from, to);
      const leading = raw.search(/\S/);
      const trailing = raw.trimEnd().length;
      return leading < 0
        ? null
        : {
            text: raw.slice(leading, trailing),
            start: sentence.start + from + leading,
            end: sentence.start + from + trailing,
          };
    })
    .filter(Boolean);
}

function explicitStatus(text, fallback) {
  if (
    ["clinical", "third_party", "historical", "hypothetical"].includes(fallback)
  )
    return fallback;
  if (
    /\b(?:no longer needs?|(?:has been|have been|is|are) arranged|now (?:has|have)|now able|can now afford|successfully demonstrated|now correctly|no longer confused)\b/i.test(
      text,
    )
  )
    return "resolved";
  if (
    /\b(?:denies|denied|no (?:current )?(?:concerns?|difficulty|problems?)|without difficulty|has reliable|have reliable|adequate groceries|independently demonstrated)\b/i.test(
      text,
    )
  )
    return "negated";
  if (
    /\bno (?:ride|transport(?:ation)?|cost|food|instruction)[^.!?]{0,30}\b(?:remains? outstanding|is outstanding|needs? arranging)\b/i.test(
      text,
    )
  )
    return "resolved";
  return fallback;
}

export function readLiveNote(note = {}) {
  if (typeof note === "string") note = { text: note };
  const text = String(note.text || "");
  const frozen = readFrozenNote(note);
  const sentences = [];
  const assertions = [];
  for (const sentence of frozen.sentences) {
    for (const clause of clauseRanges(sentence)) {
      const read = readFrozenNote({ ...note, text: clause.text }).sentences[0];
      if (!read) continue;
      let status = explicitStatus(
        clause.text.replace(/[’‘]/g, "'"),
        read.status,
      );
      // Splitting an independent clause must not turn a family-only, historical,
      // clinical or hypothetical sentence into current patient evidence. A
      // subsequent clause must explicitly return to the patient to change scope.
      if (
        ["clinical", "third_party", "historical", "hypothetical"].includes(
          sentence.status,
        ) &&
        !/^(?:pt|patient|I)\b(?!'s)/i.test(clause.text)
      )
        status = sentence.status;
      const current = read.assertions.map((assertion) => ({
        ...assertion,
        status,
        resolved: status === "resolved",
        quote: clause.text,
        evidence_sentence: clause.text,
        char_span: [clause.start, clause.end],
      }));
      // Explicit denials/resolutions do not need obstacle wording. In particular,
      // "I no longer need transportation" must supersede an older active edge.
      if (["resolved", "negated"].includes(status)) {
        for (const [type, pattern] of Object.entries(typeMention)) {
          if (
            pattern.test(clause.text) &&
            !current.some((a) => a.type === type)
          )
            current.push({
              type,
              status,
              resolved: status === "resolved",
              quote: clause.text,
              evidence_sentence: clause.text,
              char_span: [clause.start, clause.end],
              confidence: 0.98,
              note_id: note.id || null,
              documentId: note.id || null,
              note_type: note.note_type || "Clinical note",
              date: note.date || note.written_datetime?.slice(0, 10) || null,
              written_datetime: note.written_datetime || null,
              sourceKind: "note",
              authorRole: note.author_role || note.authorRole || null,
              daysFromDischarge: note.daysFromDischarge ?? null,
              action_recorded: Boolean(note.action_recorded),
              actionRecorded: Boolean(note.action_recorded),
            });
        }
      }
      assertions.push(...current);
      sentences.push({
        ...read,
        ...clause,
        status,
        assertions: current,
        outcome: current.some((a) => a.status === "active")
          ? "edge_created"
          : Object.values(read.scores).some((n) => n > 0)
            ? "rejected"
            : "no_signal",
        reason:
          status === "resolved"
            ? "The clause explicitly records that this difficulty is resolved."
            : status === "negated"
              ? "The clause explicitly denies this difficulty."
              : read.reason,
      });
    }
  }
  return { version: LIVE_READER_VERSION, sentences, assertions };
}
