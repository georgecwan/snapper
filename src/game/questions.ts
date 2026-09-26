export type Category =
  | "Science"
  | "Math"
  | "History"
  | "Literature"
  | "Arts"
  | "Geography"
  | "Canada"
  | "Sport";

export type SetId = "mixed" | "science" | "humanities" | "canada";

export type Tossup = {
  id: string;
  category: Category;
  /** Visible text. A single ¶ marks the power boundary and is not shown. */
  text: string;
  answer: string;
  accepts: string[];
};

export const SETS: { id: SetId; label: string; blurb: string }[] = [
  {
    id: "mixed",
    label: "Open desk",
    blurb: "Science, history, arts, maps, and a Canadian thread.",
  },
  {
    id: "science",
    label: "Lab & chalkboard",
    blurb: "Physics, life science, and a little math.",
  },
  {
    id: "humanities",
    label: "Books & the past",
    blurb: "History, literature, and art.",
  },
  {
    id: "canada",
    label: "True north",
    blurb: "A short Canadian packet.",
  },
];

export const QUESTIONS: Tossup[] = [
  {
    id: "mito",
    category: "Science",
    text: "Lynn Margulis championed the idea that this organelle began as a free-living bacterium, which fits its circular DNA and habit of dividing by binary fission.¶ Its inner membrane is folded into cristae that house the electron transport chain. For 10 points, name this “powerhouse of the cell,” where most ATP is made.",
    answer: "mitochondria",
    accepts: ["mitochondrion", "the mitochondrion", "a mitochondrion"],
  },
  {
    id: "grav",
    category: "Science",
    text: "Henry Cavendish used a torsion balance in 1798 to measure the constant that sets the strength of this interaction.¶ Newton wrote it as proportional to the product of two masses divided by the square of the distance between them. Near Earth’s surface it accelerates objects at about 9.8 meters per second squared. For 10 points, name this attractive force.",
    answer: "gravity",
    accepts: ["gravitation", "gravitational force", "the force of gravity"],
  },
  {
    id: "light",
    category: "Science",
    text: "Ole Rømer estimated this constant in 1676 by timing eclipses of Io, which seemed late when Jupiter was farther from Earth.¶ In a vacuum it is defined as exactly 299,792,458 meters per second, and no object with mass can reach it. For 10 points, name this cosmic speed limit, denoted c.",
    answer: "the speed of light",
    accepts: ["speed of light", "light speed", "c"],
  },
  {
    id: "dna",
    category: "Science",
    text: "Rosalind Franklin’s Photo 51, an X-ray image, was key evidence for the shape of this molecule, which Watson and Crick described in 1953.¶ It stores genetic information with the bases adenine, thymine, cytosine, and guanine. For 10 points, name this double helix whose initials stand for deoxyribonucleic acid.",
    answer: "DNA",
    accepts: ["deoxyribonucleic acid", "deoxyribonucleic acid dna"],
  },
  {
    id: "plates",
    category: "Science",
    text: "Alfred Wegener was mocked for suggesting continents plow through the ocean crust, an idea later saved by seafloor spreading at mid-ocean ridges.¶ The lithosphere is broken into moving slabs whose collisions raise mountain belts. For 10 points, name this theory of the large-scale motion of Earth’s plates.",
    answer: "plate tectonics",
    accepts: ["plate tectonic theory", "tectonic plates", "tectonics"],
  },
  {
    id: "penicillin",
    category: "Science",
    text: "In 1928 Alexander Fleming noticed that a mold contaminating a petri dish had cleared nearby Staphylococcus.¶ Howard Florey and Ernst Chain later turned that accident into a mass-produced drug. For 10 points, name this first widely used antibiotic, produced by the genus Penicillium.",
    answer: "penicillin",
    accepts: ["penicillin antibiotic"],
  },
  {
    id: "hole",
    category: "Science",
    text: "The Event Horizon Telescope released the first image of one of these objects, in the galaxy M87, in 2019.¶ Their boundary is a surface from which not even light can climb out, and stellar ones can form when massive stars collapse. For 10 points, name these regions of spacetime predicted by general relativity.",
    answer: "black holes",
    accepts: ["black hole", "a black hole"],
  },
  {
    id: "jenner",
    category: "Science",
    text: "In 1796 this English doctor inoculated James Phipps with material from a milkmaid’s cowpox sore, then showed the boy resisted smallpox.¶ The practice took its name from the Latin for cow, vacca. For 10 points, name this pioneer of vaccination.",
    answer: "Edward Jenner",
    accepts: ["Jenner", "Edward Jenner MD"],
  },
  {
    id: "pyth",
    category: "Math",
    text: "Babylonian tablets already record number triples that satisfy this relation, long before a Greek philosopher was credited with a proof.¶ It says that in a right triangle the square on the hypotenuse equals the sum of the squares on the other two sides. For 10 points, name this theorem often written a squared plus b squared equals c squared.",
    answer: "the Pythagorean theorem",
    accepts: ["Pythagorean theorem", "Pythagoras theorem", "Pythagoras's theorem", "Pythagoras"],
  },
  {
    id: "pi",
    category: "Math",
    text: "Archimedes trapped this constant between fractions by inscribing and circumscribing polygons around a circle.¶ It is the ratio of a circle’s circumference to its diameter, and its decimal begins 3.14159. For 10 points, name this irrational number written with a Greek letter.",
    answer: "pi",
    accepts: ["π"],
  },
  {
    id: "tubman",
    category: "History",
    text: "Born Araminta Ross in Maryland, this woman escaped slavery in 1849 and returned south many times as a conductor.¶ During the Civil War she scouted for the Union and guided the Combahee River Raid. For 10 points, name this abolitionist nicknamed Moses.",
    answer: "Harriet Tubman",
    accepts: ["Tubman", "Araminta Ross", "Minty Ross"],
  },
  {
    id: "wall",
    category: "History",
    text: "Construction of this barrier began overnight on August 13, 1961, after millions had already left the east.¶ Checkpoint Charlie was its most famous crossing, and a bungled press conference opened it on November 9, 1989. For 10 points, name this concrete division of Berlin.",
    answer: "the Berlin Wall",
    accepts: ["Berlin Wall"],
  },
  {
    id: "apartheid",
    category: "History",
    text: "Hendrik Verwoerd became a chief architect of this system after the National Party won South Africa’s 1948 election.¶ Pass laws restricted movement, and it collapsed in the early 1990s before Nelson Mandela’s presidency. For 10 points, name this policy of racial separation whose Afrikaans name means “apartness.”",
    answer: "apartheid",
    accepts: [],
  },
  {
    id: "apollo",
    category: "History",
    text: "Michael Collins stayed in orbit while a lunar module named Eagle descended toward the Sea of Tranquility.¶ On July 20, 1969, Neil Armstrong radioed that it was “one small step for man.” For 10 points, name this NASA mission, the first to land humans on the Moon.",
    answer: "Apollo 11",
    accepts: ["Apollo eleven", "the Apollo 11 mission"],
  },
  {
    id: "pride",
    category: "Literature",
    text: "This novel’s famous first sentence claims that a single man in possession of a good fortune must be in want of a wife.¶ Elizabeth Bennet refuses, then later accepts, a proposal from the proud Fitzwilliam Darcy of Pemberley. For 10 points, name this novel by Jane Austen.",
    answer: "Pride and Prejudice",
    accepts: ["Pride & Prejudice"],
  },
  {
    id: "hamlet",
    category: "Literature",
    text: "A ghost on the battlements of Elsinore tells a prince that the man who killed his father now wears the crown.¶ The prince stages The Murder of Gonzago and asks whether to be or not to be. For 10 points, name this Shakespeare tragedy about the Prince of Denmark.",
    answer: "Hamlet",
    accepts: ["The Tragedy of Hamlet", "Hamlet Prince of Denmark"],
  },
  {
    id: "1984",
    category: "Literature",
    text: "This novel’s protagonist rewrites old newspapers at the Ministry of Truth and rents a room without a telescreen to meet Julia.¶ He is broken in Room 101 by O’Brien, who shows him his greatest fear. For 10 points, name this dystopian novel by George Orwell, titled for a year.",
    answer: "1984",
    accepts: ["Nineteen Eighty-Four", "Nineteen Eighty Four"],
  },
  {
    id: "handmaid",
    category: "Literature",
    text: "Offred is assigned to bear a child for a Commander and his wife Serena Joy in the Republic of Gilead.¶ A Canadian author published this dystopia in 1985; it later became a television series. For 10 points, name this novel by Margaret Atwood.",
    answer: "The Handmaid's Tale",
    accepts: ["Handmaid's Tale", "The Handmaids Tale", "Handmaids Tale"],
  },
  {
    id: "ninth",
    category: "Arts",
    text: "A baritone interrupts this work’s finale to reject the earlier music, after which a chorus sings Schiller’s “Ode to Joy.”¶ Its composer, nearly deaf, had to be turned around at the 1824 Vienna premiere to see the applause. For 10 points, name this final symphony of Ludwig van Beethoven.",
    answer: "Symphony No. 9",
    accepts: [
      "Beethoven's Ninth",
      "Beethoven's 9th",
      "the Ninth Symphony",
      "Ninth Symphony",
      "Choral Symphony",
      "Symphony Number 9",
      "Beethoven Symphony 9",
      "Beethoven's Symphony No. 9",
      "9th symphony",
    ],
  },
  {
    id: "seven",
    category: "Arts",
    text: "Franklin Carmichael, A. Y. Jackson, and Lawren Harris were in this collective, which first exhibited in Toronto in 1920.¶ They painted Algoma, Algonquin, and the north shore of Lake Superior in bold color, following a trail Tom Thomson had started before his death. For 10 points, name this group of Canadian landscape painters.",
    answer: "the Group of Seven",
    accepts: ["Group of Seven"],
  },
  {
    id: "starry",
    category: "Arts",
    text: "A towering cypress and a swirling sky dominate this canvas, painted in June 1889 at an asylum in Saint-Rémy.¶ Its Dutch maker died the next year, and the picture now hangs in the Museum of Modern Art. For 10 points, name this night landscape by Vincent van Gogh.",
    answer: "The Starry Night",
    accepts: ["Starry Night"],
  },
  {
    id: "wave",
    category: "Arts",
    text: "Three boats and a distant Mount Fuji sit under a curling crest in this woodblock print from the series Thirty-six Views of Mount Fuji.¶ It was designed by Hokusai in the early 1830s. For 10 points, name this Japanese image of a great wave off Kanagawa.",
    answer: "The Great Wave off Kanagawa",
    accepts: [
      "The Great Wave",
      "Great Wave off Kanagawa",
      "Under the Wave off Kanagawa",
      "The Great Wave Off Kanagawa",
    ],
  },
  {
    id: "nile",
    category: "Geography",
    text: "Its two great branches, the White and the Blue, meet at Khartoum in Sudan.¶ Ancient fields depended on its summer flood, and its delta spreads into the Mediterranean. For 10 points, name this longest river in Africa.",
    answer: "the Nile",
    accepts: ["Nile", "Nile River", "the Nile River"],
  },
  {
    id: "sahara",
    category: "Geography",
    text: "Ergs of dunes and gravel plains called regs cover parts of this region, which runs from the Atlantic to the Red Sea.¶ Its name comes from an Arabic word for desert, and it is the largest hot desert on Earth. For 10 points, name this North African desert.",
    answer: "the Sahara",
    accepts: ["Sahara", "Sahara Desert", "the Sahara Desert"],
  },
  {
    id: "confed",
    category: "Canada",
    text: "New Brunswick and Nova Scotia joined a larger colony that was then split into Ontario and Quebec.¶ The British North America Act took effect on July 1, and John A. Macdonald became the first prime minister. For 10 points, give the year of Canadian Confederation.",
    answer: "1867",
    accepts: ["July 1 1867", "1 July 1867", "July 1st 1867"],
  },
  {
    id: "fox",
    category: "Canada",
    text: "After losing his right leg to osteosarcoma, this British Columbian dipped his artificial leg in the Atlantic at St. John’s in 1980.¶ He ran west to raise money for cancer research until chest pains stopped him near Thunder Bay. For 10 points, name this athlete of the Marathon of Hope.",
    answer: "Terry Fox",
    accepts: ["Terrance Fox", "Terrance Stanley Fox"],
  },
  {
    id: "banff",
    category: "Canada",
    text: "Hot springs found by railway workers in the 1880s led Canada to reserve this stretch of the Rockies, the country’s first national park.¶ Lake Louise and a grand hotel on the Bow River still anchor its main town. For 10 points, name that Alberta town.",
    answer: "Banff",
    accepts: ["Banff Alberta", "Banff town"],
  },
  {
    id: "inuk",
    category: "Canada",
    text: "Built by Inuit from unworked stones, these figures can mark a route, a cache, or a place of respect across the Arctic.¶ A human-shaped one became the emblem of the 2010 Vancouver Winter Olympics. For 10 points, name these landmarks, from an Inuktitut word meaning “in the likeness of a person.”",
    answer: "inuksuk",
    accepts: ["inukshuk", "inuksuit", "inunnguaq"],
  },
  {
    id: "syrup",
    category: "Canada",
    text: "A sugar shack, or cabane à sucre, is a traditional place to pour this food over snow and eat it with a wooden stick.¶ Quebec produces most of the world’s supply by boiling spring sap from a namesake tree. For 10 points, name this sweetener from trees in the genus Acer.",
    answer: "maple syrup",
    accepts: ["maple sirup"],
  },
  {
    id: "riel",
    category: "Canada",
    text: "This Métis leader headed provisional governments during the Red River Resistance and the North-West Resistance, demanding land rights against Canadian expansion.¶ He was hanged for treason at Regina in 1885. For 10 points, name this founder of Manitoba.",
    answer: "Louis Riel",
    accepts: ["Riel"],
  },
  {
    id: "niagara",
    category: "Canada",
    text: "Goat Island splits these falls into a Horseshoe section and an American section, on a river linking Lake Erie to Lake Ontario.¶ Boats crowd the basin, and hydro plants divert part of the flow. For 10 points, name these famous falls shared by Ontario and New York.",
    answer: "Niagara Falls",
    accepts: ["Niagara"],
  },
  {
    id: "banting",
    category: "Canada",
    text: "With Charles Best at the University of Toronto, this surgeon isolated a pancreatic extract that revived diabetic dogs.¶ He shared the 1923 Nobel Prize in Physiology or Medicine with J. J. R. Macleod. For 10 points, name this Canadian co-discoverer of insulin.",
    answer: "Frederick Banting",
    accepts: ["Banting", "Sir Frederick Banting", "Frederick Grant Banting"],
  },
  {
    id: "bluenose",
    category: "Canada",
    text: "Built in Lunenburg, Nova Scotia, this schooner beat American rivals for the International Fishermen’s Trophy and later appeared on the Canadian dime.¶ She was wrecked on a Haitian reef in 1946. For 10 points, name this racing fishing vessel, also a nickname for Nova Scotians.",
    answer: "the Bluenose",
    accepts: ["Bluenose"],
  },
  {
    id: "hoop",
    category: "Sport",
    text: "A Canadian instructor at a Springfield, Massachusetts YMCA invented this indoor game in December 1891 so students would stay active in winter.¶ He nailed peach baskets to a balcony and wrote thirteen rules. For 10 points, name this sport whose hoop now stands ten feet high.",
    answer: "basketball",
    accepts: [],
  },
  {
    id: "stanley",
    category: "Sport",
    text: "Lord Stanley of Preston, then Governor General of Canada, bought this trophy in 1892 for the top amateur hockey club in the country.¶ It is now engraved with NHL champions and is among the oldest trophies still contested by professionals. For 10 points, name this cup.",
    answer: "the Stanley Cup",
    accepts: ["Stanley Cup", "Lord Stanley's Cup"],
  },
];

export function questionView(q: Tossup): { visible: string; powerAt: number } {
  const idx = q.text.indexOf("¶");
  if (idx < 0) return { visible: q.text, powerAt: 0 };
  const before = q.text.slice(0, idx);
  const after = q.text.slice(idx + 1);
  return { visible: before + after, powerAt: before.length };
}

export function getQuestion(id: string): Tossup | undefined {
  return QUESTIONS.find((q) => q.id === id);
}

export function inSet(setId: SetId, q: Tossup): boolean {
  if (setId === "mixed") return true;
  if (setId === "science") return q.category === "Science" || q.category === "Math";
  if (setId === "humanities")
    return q.category === "History" || q.category === "Literature" || q.category === "Arts";
  return q.category === "Canada";
}

export function questionsFor(setId: SetId): Tossup[] {
  return QUESTIONS.filter((q) => inSet(setId, q));
}

export function setLabel(setId: SetId): string {
  return SETS.find((s) => s.id === setId)?.label ?? "Open desk";
}
