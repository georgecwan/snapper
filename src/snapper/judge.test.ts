import test from "node:test";
import assert from "node:assert/strict";
import { judgeAnswer, normalizeAnswer } from "./judge.ts";
import type { AnswerSpec } from "./protocol.ts";

const mitochondria: AnswerSpec = { canonical: "mitochondria", aliases: ["mitochondrion"] };
test("exact answers, authored aliases and close spelling are accepted", () => {
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
test("authored insufficient answers prompt once and explicit rejections take precedence", () => {
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
test("complete meaningful words from an accepted answer prompt for the missing detail once", () => {
  const spec: AnswerSpec = {
    canonical: "Theodore Roosevelt",
    aliases: ["Teddy Roosevelt"],
  };
  for (const text of ["Roosevelt", "Theodore", "Teddy", "THE ROOSEVELT"])
    assert.equal(judgeAnswer(text, spec), "prompt", text);
  assert.equal(judgeAnswer("Roosevelt", spec, true), "reject");
  assert.equal(judgeAnswer("Theodore Roosevelt", spec, true), "accept");
  assert.equal(judgeAnswer("Teddy Roosevelt", spec, true), "accept");
  assert.equal(judgeAnswer("Theodore Roosevel", spec), "accept", "existing typo tolerance stays");
  assert.equal(judgeAnswer("Roosevelt", { ...spec, rejects: ["Roosevelt"] }), "reject");

  assert.equal(
    judgeAnswer("Martin King", { canonical: "Martin Luther King Jr.", aliases: [] }),
    "prompt",
  );
  assert.equal(judgeAnswer("Zola", { canonical: "Émile Zola", aliases: [] }), "prompt");
  assert.equal(judgeAnswer("Apollo", { canonical: "Apollo 11", aliases: [] }), "prompt");
});
test("partial prompting does not rescue wrong words, fragments, signs or alternatives", () => {
  const spec: AnswerSpec = { canonical: "Theodore Roosevelt", aliases: ["Teddy Roosevelt"] };
  for (const text of [
    "Franklin Roosevelt",
    "Roose",
    "Roosevelt Theodore",
    "Roosevelt Roosevelt",
    "not Roosevelt",
    "no Roosevelt",
    "Roosevelt or Teddy",
    "Roosevelt/Teddy",
    "Roosevelt except Theodore",
    "President Roosevelt",
  ])
    assert.equal(judgeAnswer(text, spec), "reject", text);
  for (const [text, canonical] of [
    ["of", "United States of America"],
    ["and", "War and Peace"],
    ["19", "October 1999"],
    ["Apollo 1", "Apollo 11"],
    ["-5", "5"],
    ["5", "minus 5"],
    ["temperature 5", "temperature -5"],
    ["constant 6", "constant 6.02"],
    ["Paul", "Jean-Paul Sartre"],
  ])
    assert.equal(judgeAnswer(text!, { canonical: canonical!, aliases: [] }), "reject", text);
});
test("common typos, swapped letters and harmless missing words are accepted", () => {
  for (const [text, canonical] of [
    ["Prais", "Paris"],
    ["Pariss", "Paris"],
    ["Einstien", "Einstein"],
    ["mitocondrea", "mitochondria"],
    ["William Shakespere", "William Shakespeare"],
    ["Januray 1, 1970", "January 1, 1970"],
    ["United States America", "United States of America"],
    ["War Peace", "War and Peace"],
    ["University California", "University of California"],
  ]) {
    const spec = { canonical: canonical!, aliases: [] };
    assert.equal(judgeAnswer(text!, spec), "accept", text);
    assert.equal(judgeAnswer(text!, spec, true), "accept", `clarification: ${text}`);
  }
});
test("close partial spellings prompt once without granting points for missing key details", () => {
  const spec = { canonical: "Theodore Roosevelt", aliases: ["Teddy Roosevelt"] };
  for (const text of ["Roosevel", "Roosevlet", "Tedy", "Theodores"]) {
    assert.equal(judgeAnswer(text, spec), "prompt", text);
    assert.equal(judgeAnswer(text, spec, true), "reject", text);
  }
  assert.equal(
    judgeAnswer("Universty", { canonical: "University of California", aliases: [] }),
    "prompt",
  );
  assert.equal(judgeAnswer("Roosevel", { ...spec, promptAliases: ["Roosevelt"] }), "prompt");
  assert.equal(judgeAnswer("Roosevel", { ...spec, rejects: ["Roosevelt"] }), "reject");
});
test("looser matching preserves distinct short answers, wrong details and authored rejects", () => {
  for (const [text, canonical] of [
    ["Iraq", "Iran"],
    ["Mars", "cars"],
    ["nitrogen", "hydrogen"],
    ["Apollo 12", "Apollo 11"],
    ["January 2, 1970", "January 1, 1970"],
    ["January 1, 1971", "January 1, 1970"],
    ["negative 5", "positive 5"],
    ["not Paris", "Paris"],
    ["Paris or London", "Paris"],
    ["University Texas", "University of California"],
    ["North Korea", "South Korea"],
  ])
    assert.equal(judgeAnswer(text!, { canonical: canonical!, aliases: [] }), "reject", text);
  const painter = { canonical: "Monet", aliases: [], rejects: ["Manet"] };
  assert.equal(
    judgeAnswer("Monet", painter),
    "accept",
    "correct exact answer wins over nearby rejected spelling",
  );
  assert.equal(judgeAnswer("Mnaet", painter), "reject");
  assert.equal(judgeAnswer("Manet", painter), "reject");
  assert.equal(
    judgeAnswer("War Peace", {
      canonical: "War and Peace",
      aliases: [],
      promptAliases: ["War Peace"],
    }),
    "prompt",
  );
});
test("ordered responses allow spelling mistakes but still need every item in order", () => {
  const spec = {
    canonical: "Mercury, Venus, Earth",
    aliases: [],
    orderedItems: [["Mercury"], ["Venus"], ["Earth"]],
  };
  assert.equal(judgeAnswer("Mercuy, Vneus, Eatrh", spec), "accept");
  assert.equal(judgeAnswer("Mercuy, Vneus", spec), "prompt");
  assert.equal(judgeAnswer("Mercuy, Vneus", spec, true), "reject");
  assert.equal(judgeAnswer("Vneus, Mercuy, Eatrh", spec), "reject");
});
test("a complete numeric or date component prompts once without accepting fragments or changing signs", () => {
  const epoch: AnswerSpec = { canonical: "january 1, 1970", aliases: [] };
  assert.equal(judgeAnswer("1970", epoch), "prompt");
  assert.equal(judgeAnswer("1970", epoch, true), "reject");
  assert.equal(judgeAnswer("January 1, 1970", epoch, true), "accept");
  assert.equal(judgeAnswer("1", epoch), "prompt");
  assert.equal(judgeAnswer("January 1970", epoch), "prompt");
  for (const text of ["19", "70", "-1970", "January 2", "1970 January"])
    assert.equal(judgeAnswer(text, epoch), "reject", text);
  assert.equal(judgeAnswer("1970", { ...epoch, rejects: ["1970"] }), "reject");
  assert.equal(judgeAnswer("1970", { canonical: "1970", aliases: [] }), "accept");
  assert.equal(judgeAnswer("11", { canonical: "Apollo 11", aliases: [] }), "prompt");
  assert.equal(judgeAnswer("1999", { canonical: "October 1999", aliases: [] }), "prompt");
  for (const canonical of ["-5 degrees", "minus 5", "negative 5", "+5 degrees"])
    assert.equal(judgeAnswer("5", { canonical, aliases: [] }), "reject", canonical);
});
test("an accepted short alias stays correct instead of being treated as a partial canonical answer", () => {
  assert.equal(
    judgeAnswer("Roosevelt", { canonical: "Theodore Roosevelt", aliases: ["Roosevelt"] }),
    "accept",
  );
});
test("ordered responses are all-or-nothing with no empty or extra slots", () => {
  const spec = {
    canonical: "Mercury, Venus, Earth",
    aliases: [],
    orderedItems: [["Mercury"], ["Venus"], ["Earth", "Terra"]],
  };
  assert.equal(judgeAnswer("Mercury; Venus; Terra", spec), "accept");
  for (const text of ["Venus, Mercury, Earth", "Mercury, Venus, Earth, Mars", "Mercury,,Earth"]) {
    assert.equal(judgeAnswer(text, spec), "reject", text);
  }
  assert.equal(judgeAnswer("Mercury, Venus", spec), "prompt");
  assert.equal(judgeAnswer("Mercury, Venus", spec, true), "reject");
  assert.equal(judgeAnswer("Mercury, Venus, Earth", spec, true), "accept");
});
test("sequence clarification accepts only correctly ordered prefixes or positioned partial names", () => {
  const spec: AnswerSpec = {
    canonical: "George Washington; John Adams; Thomas Jefferson",
    aliases: [],
    orderedItems: [["George Washington"], ["John Adams"], ["Thomas Jefferson"]],
  };
  for (const text of [
    "George Washington",
    "George Washington; John Adams",
    "Washington; Adams; Jefferson",
    "Washington; John Adams",
  ]) {
    assert.equal(judgeAnswer(text, spec), "prompt", text);
    assert.equal(judgeAnswer(text, spec, true), "reject", text);
  }
  for (const text of [
    "Adams; Washington",
    "George Washington; Thomas Jefferson",
    "George Washington; John Quincy Adams",
    "George Washington;",
    "; John Adams",
    "Washington;;Jefferson",
    "Wash; Adams; Jefferson",
    "George Washington; John Adams; Thomas Jefferson; Madison",
  ])
    assert.equal(judgeAnswer(text, spec), "reject", text);
  assert.equal(
    judgeAnswer("Washington; Adams; Jefferson", {
      ...spec,
      rejects: ["Washington; Adams; Jefferson"],
    }),
    "reject",
  );
});
