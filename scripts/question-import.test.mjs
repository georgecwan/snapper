import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanText,
  parseOpenTriviaFile,
  quizbowlAnswer,
  shortAtom,
  qantaAtom,
} from "./question-import.mjs";
const provenance = { label: "test", license: "test" };
test("short imports reject choice-dependent, dated, broken and explanatory answers", () => {
  for (const [q, a] of [
    ["Which of these cities is in France?", "Paris"],
    ["Who is the current president of France?", "Emmanuel Macron"],
    ["What is in the pictured painting?", "A tree"],
    ["What is the capital of Fr\ufffdnce?", "Paris"],
    ["Why does the planet spin?", "Because of gravity"],
    ["What colours does this make?", "Both red and blue"],
  ])
    assert.equal(shortAtom(q, a, "General", "unrated", provenance), null, q);
  assert.ok(
    shortAtom("What is the capital of France?", "Paris", "Geography", "unrated", provenance),
  );
  assert.equal(cleanText("Caf&#233; &amp; Tea&nbsp;"), "Café & Tea");
});
test("quizbowl parsing retains explicit simple rules without inventing timing or aliases", () => {
  assert.deepEqual(quizbowlAnswer("New Zealand [accept Aotearoa]"), {
    canonical: "New Zealand",
    aliases: ["Aotearoa"],
  });
  assert.deepEqual(quizbowlAnswer("Darius I [or Darius the Great; prompt on Darius]"), {
    canonical: "Darius I",
    aliases: ["Darius the Great"],
    promptAliases: ["Darius"],
  });
  for (const answer of [
    "Titanium [or Ti before read]",
    "French {Third} Republic",
    "Paris [accept word forms]",
    "Thing [accept anything similar]",
    "Name [prompt on partial answer]",
    "bird [accept general equivalents like avians but not specific birds]",
    "dog [accept wolf on the first clue]",
    "Cherenkov radiation /effect",
    "King [do not accept more specific answers]",
  ])
    assert.equal(quizbowlAnswer(answer), null, answer);
});
test("source parser requires a well-formed record with a matching correct choice", () => {
  const result = parseOpenTriviaFile(
    "#Q Which capital city?\n^ Paris\nA London\nB Paris\n\n#Q Bad key?\n^ Rome\nA London\nB Paris\n",
  );
  assert.equal(result.count, 2);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].answer, "Paris");
});
test("quizbowl imports keep provenance, map source difficulty and never invent power marks", () => {
  const row = {
    text: "This French capital has a river named the Seine, a famous iron tower, and a museum named the Louvre. Name this city.",
    answer: "Paris",
    category: "Geography",
    difficulty: "HS",
    qanta_id: 17,
    tournament: "Test",
    year: 2007,
    dataset: "quizdb",
  };
  const atom = qantaAtom(row, "train");
  assert.equal(atom.difficulty, "medium");
  assert.equal(atom.powerAt, undefined);
  assert.match(atom.provenance.label, /train #17/);
  assert.equal(qantaAtom({ ...row, difficulty: null }, "train").difficulty, "unrated");
  assert.equal(qantaAtom({ ...row, text: "Currently " + row.text }, "train"), null);
  const powered = qantaAtom(
    { ...row, text: row.text.replace("a famous", "(*) a famous") },
    "train",
  );
  assert.ok(powered.powerAt > 0);
  assert.equal(powered.text.includes("(*)"), false);
  assert.equal(qantaAtom({ ...row, text: row.text + " (**)" }, "train"), null);
});
