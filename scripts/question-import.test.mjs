import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanText,
  parseOpenTriviaFile,
  quizbowlAnswer,
  shortAtom,
  qantaAtom,
  triviaApiAtom,
  parseLearnClashFile,
  learnClashAtom,
} from "./question-import.mjs";
import { judgeAnswer } from "../src/snapper/judge.ts";
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
test("required-word markup preserves full names, all required spans and explicit rejects", () => {
  const newton = quizbowlAnswer("Sir Isaac {Newton}");
  assert.deepEqual(newton, { canonical: "Sir Isaac Newton", aliases: ["Newton"] });
  assert.equal(judgeAnswer("Newton", newton), "accept");
  assert.notEqual(judgeAnswer("Isaac", newton), "accept");
  const king = quizbowlAnswer("{Henry VIII} of England [reject {Henry VII}; prompt on Henry]");
  assert.equal(judgeAnswer("Henry VIII", king), "accept");
  assert.equal(judgeAnswer("Henry VII", king), "reject");
  assert.equal(judgeAnswer("Henry", king), "prompt");
  const republic = quizbowlAnswer("{French} {Third} Republic");
  assert.equal(judgeAnswer("French Third", republic), "accept");
  assert.notEqual(judgeAnswer("French", republic), "accept");
  assert.notEqual(judgeAnswer("Third", republic), "accept");
  assert.deepEqual(quizbowlAnswer("{Mughal} Empire [or {Mogul} Empire]"), {
    canonical: "Mughal Empire",
    aliases: ["Mughal", "Mogul Empire", "Mogul"],
  });
  for (const answer of [
    "{{Newton}}",
    "{Newton",
    "Newton}",
    "{} Newton",
    "{A} [or {B} before mention]",
    "{X} [accept {Y}, {Z}]",
    "{X} (pronunciation)",
    "The {Three Musketeers} Accept Les Trois Mousquetaires",
    "{R}ichard {Strauss} Prompt on Strauss",
    "ANSWER: Battle of {Cannae}",
  ])
    assert.equal(quizbowlAnswer(answer), null, answer);
});
test("new short sources validate schema, preserve rating/licensing and reject unsafe prompts", () => {
  const row = {
    id: "622a1c3c7cc59eab6f951979",
    type: "text_choice",
    category: "geography",
    difficulty: "medium",
    question: { text: "What is the capital of France?" },
    correctAnswer: "Paris",
    incorrectAnswers: ["Berlin", "Rome", "Madrid"],
    tags: [],
  };
  const atom = triviaApiAtom(row);
  assert.equal(atom.difficulty, "medium");
  assert.equal(atom.category, "Geography");
  assert.match(atom.provenance.license, /CC BY-NC 4.0/);
  assert.match(atom.provenance.url, new RegExp(row.id));
  const count = triviaApiAtom({
    ...row,
    question: { text: "How many kidneys do humans typically have?" },
    correctAnswer: "Two",
  });
  assert.equal(judgeAnswer("2", count.answer), "accept");
  assert.equal(judgeAnswer("3", count.answer), "reject");
  assert.deepEqual(
    triviaApiAtom({ ...row, correctAnswer: "One" }).answer.aliases,
    [],
    "Do not rewrite numbered titles",
  );
  const heldOut = {
    [row.id]: {
      originalQuestion: row.question.text,
      originalAnswer: row.correctAnswer,
      exclude: "Reviewed ambiguity",
    },
  };
  assert.equal(triviaApiAtom(row, heldOut), null);
  assert.throws(
    () => triviaApiAtom({ ...row, correctAnswer: "Lyon" }, heldOut),
    /no longer matches/,
  );
  assert.equal(
    triviaApiAtom({ ...row, category: "arts_and_literature", tags: ["literature"] }).category,
    "Literature",
  );
  assert.equal(
    triviaApiAtom({ ...row, category: "arts_and_literature", tags: {} }).category,
    "Arts",
  );
  assert.equal(
    triviaApiAtom({ ...row, category: "society_and_culture", tags: ["religion"] }).category,
    "Religion",
  );
  for (const update of [
    { type: "image_choice" },
    { difficulty: "unknown" },
    { language: "fr" },
    { category: "unknown" },
    { category: "toString" },
    { correctAnswer: "Paris (France)" },
    { question: { text: "Who is the most influential ruler?" } },
    { question: { text: "What is the highest-grossing film?" } },
    { incorrectAnswers: ["Paris", "Rome", "Madrid"] },
    { question: { text: "Which of the following is a city?" } },
  ])
    assert.equal(triviaApiAtom({ ...row, ...update }), null);
  const learned = {
    id: 3,
    category: "Science",
    question: "What is the most abundant gas in Earth's atmosphere?",
    answer: "Nitrogen (about 78%)",
  };
  const review = {
    3: {
      originalQuestion: learned.question,
      originalAnswer: learned.answer,
      canonical: "Nitrogen",
      aliases: [],
    },
  };
  const converted = learnClashAtom(learned, "revision", review);
  assert.equal(converted.answer.canonical, "Nitrogen");
  assert.equal(converted.difficulty, "unrated");
  assert.match(converted.provenance.license, /CC BY 4.0/);
  assert.throws(
    () => learnClashAtom({ ...learned, answer: "Oxygen" }, "revision", review),
    /no longer matches/,
  );
});
test("LearnClash extracts JSON literals without evaluating upstream scripts", () => {
  const literal =
    'const questions = [\n  // Category\n  {id:1,category:"Science",q:"A question?",a:"An answer",explain:"A reason"},\n];';
  assert.equal(parseLearnClashFile(literal)[0].answer, "An answer");
  assert.throws(
    () => parseLearnClashFile(literal.replace('"An answer"', "process.exit()")),
    /Unexpected/,
  );
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
  assert.equal(qantaAtom({ ...row, answer: "{Paris}" }, "train"), null);
  assert.equal(
    qantaAtom({ ...row, dataset: "protobowl", answer: "{Paris}" }, "train").answer.canonical,
    "Paris",
  );
});
