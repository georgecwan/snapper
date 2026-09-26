import test from "node:test";
import assert from "node:assert/strict";
import { judgeAnswer, normalizeAnswer } from "./judge.ts";
import type { AnswerSpec } from "./protocol.ts";

const mitochondria: AnswerSpec = { canonical: "mitochondria", aliases: ["mitochondrion"] };
test("exact answers, authored aliases and conservative spelling are accepted", () => {
  assert.equal(judgeAnswer("The mitochondrion", mitochondria), "accept");
  assert.equal(judgeAnswer("MITOCHONDRIA", mitochondria), "accept");
  assert.equal(judgeAnswer("mitochodria", mitochondria), "accept");
});
test("negated or competing answers cannot pass by containing an answer", () => {
  for (const text of [
    "not mitochondria",
    "mitochondria or chloroplast",
    "mitochondria except",
    "the nucleus contains mitochondria",
  ]) {
    assert.equal(judgeAnswer(text, mitochondria), "reject", text);
  }
});
test("symbols, accents and signed numbers remain meaningful", () => {
  assert.equal(judgeAnswer("π", { canonical: "pi", aliases: ["π"] }), "accept");
  assert.equal(judgeAnswer("-5", { canonical: "5", aliases: [] }), "reject");
  assert.equal(judgeAnswer("Émile Zola", { canonical: "Emile Zola", aliases: [] }), "accept");
  assert.equal(normalizeAnswer("−5"), "-5");
});
test("only authored insufficient answers prompt, and only once", () => {
  const spec = {
    canonical: "Theodore Roosevelt",
    aliases: ["Teddy Roosevelt"],
    promptAliases: ["Roosevelt"],
    rejects: ["Franklin Roosevelt"],
  };
  assert.equal(judgeAnswer("Roosevelt", spec), "prompt");
  assert.equal(judgeAnswer("Roosevelt", spec, true), "reject");
  assert.equal(judgeAnswer("Franklin Roosevelt", spec), "reject");
  assert.equal(judgeAnswer("Theodore Roosevelt", spec, true), "accept");
});
test("ordered responses are all-or-nothing with no empty or extra slots", () => {
  const spec = {
    canonical: "Mercury, Venus, Earth",
    aliases: [],
    orderedItems: [["Mercury"], ["Venus"], ["Earth", "Terra"]],
  };
  assert.equal(judgeAnswer("Mercury; Venus; Terra", spec), "accept");
  for (const text of [
    "Venus, Mercury, Earth",
    "Mercury, Venus",
    "Mercury, Venus, Earth, Mars",
    "Mercury,,Earth",
  ]) {
    assert.equal(judgeAnswer(text, spec), "reject", text);
  }
});
