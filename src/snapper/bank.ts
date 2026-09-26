/** Original, reviewed fallback content. This module belongs only in the Worker. */
import { QUESTIONS } from "../game/questions.ts";
import type { QuestionAtom, QuestionBundle } from "./protocol.ts";
const provenance = { label: "Snapper original pack", license: "Original repository content" };
const atom = (
  id: string,
  text: string,
  canonical: string,
  category: string,
  aliases: string[] = [],
): QuestionAtom => ({
  id,
  text,
  category,
  answer: { canonical, aliases },
  difficulty: "medium",
  language: "en",
  provenance,
});
export const TOSSUPS: QuestionAtom[] = QUESTIONS.map((q) => {
  const before = q.text.split("¶")[0]!;
  return {
    ...atom(`original-t-${q.id}`, q.text.replace("¶", " "), q.answer, q.category, q.accepts),
    powerAt: before.length,
  };
});
const rows: Record<string, string[]> = {
  Science: [
    "What chemical element has the symbol Fe?|iron",
    "What chemical element has atomic number 6?|carbon",
    "Which noble gas fills many party balloons because it is less dense than air and nonflammable?|helium",
    "Which chemical element has the symbol Na?|sodium",
    "What process allows plants to convert light energy into chemical energy?|photosynthesis",
    "What pigment gives most plant leaves their green colour?|chlorophyll",
    "What tissue transports water from roots through a vascular plant?|xylem",
    "What structures on leaves open and close to regulate gas exchange?|stomata|stoma",
    "What SI unit measures electric current?|ampere|amp;amperes;amps",
    "What SI unit measures force?|newton|newtons",
    "What SI unit measures energy?|joule|joules",
    "What SI unit measures power?|watt|watts",
  ],
  Math: [
    "How many degrees are in a straight angle?|180|180 degrees",
    "How many sides does a regular dodecagon have?|12|twelve",
    "What is the sum, in degrees, of the interior angles of a triangle in Euclidean geometry?|180|180 degrees",
    "What is the name for a polygon with eight sides?|octagon",
    "What is the square root of 144?|12|twelve",
    "What is seven factorial?|5040|5,040",
    "What is the smallest prime number greater than 20?|23|twenty three",
    "What is the greatest common divisor of 18 and 24?|6|six",
    "In a right triangle with legs of lengths 3 and 4, what is the hypotenuse length?|5|five",
    "What is the area of a circle of radius 3, expressed as a multiple of pi?|9 pi|9π;9pi;nine pi",
    "What is the derivative of x squared with respect to x?|2x|2 x;two x",
    "What is the base-ten logarithm of 1000?|3|three",
  ],
  History: [
    "In what year did the Berlin Wall fall?|1989",
    "Which country was reunified in 1990 after decades of division into east and west?|Germany",
    "Who was the first chancellor of the German Empire, established in 1871?|Otto von Bismarck|Bismarck",
    "In which German city were major Nazi leaders tried after World War II?|Nuremberg|Nürnberg;Nurnberg",
    "Which ancient civilisation built the pyramids at Giza?|ancient Egyptians|Egyptians;Egypt;ancient Egypt",
    "Which river was central to agriculture in ancient Egypt?|Nile|the Nile;Nile River",
    "Who was the last active ruler of the Ptolemaic kingdom of Egypt?|Cleopatra VII|Cleopatra",
    "What stone helped scholars decipher Egyptian hieroglyphs?|Rosetta Stone|the Rosetta Stone",
    "Which document did King John of England seal in 1215?|Magna Carta|the Magna Carta",
    "Which battle in 1066 established William the Conqueror as ruler of England?|Battle of Hastings|Hastings",
    "Which English king had six wives?|Henry VIII|Henry the eighth;Henry 8",
    "Which British queen ruled from 1837 to 1901?|Queen Victoria|Victoria",
  ],
  Literature: [
    "Who wrote Pride and Prejudice?|Jane Austen|Austen",
    "Who wrote Frankenstein?|Mary Shelley|Shelley;Mary Wollstonecraft Shelley",
    "Who wrote Jane Eyre?|Charlotte Brontë|Charlotte Bronte",
    "Who wrote Wuthering Heights?|Emily Brontë|Emily Bronte",
    "Which Shakespeare play features the characters Oberon, Titania and Puck?|A Midsummer Night’s Dream|A Midsummer Nights Dream;Midsummer Nights Dream",
    "Which Shakespeare play begins with three witches?|Macbeth",
    "Which Shakespeare tragedy features the prince of Denmark?|Hamlet",
    "Which Shakespeare play features the twins Viola and Sebastian?|Twelfth Night|12th Night",
    "Who wrote the novel Things Fall Apart?|Chinua Achebe|Achebe",
    "Who wrote One Hundred Years of Solitude?|Gabriel García Márquez|Gabriel Garcia Marquez;Garcia Marquez;Marquez",
    "Who wrote The Metamorphosis, in which Gregor Samsa changes into a monstrous insect-like creature?|Franz Kafka|Kafka",
    "Who wrote the novel Beloved?|Toni Morrison|Morrison",
  ],
  Arts: [
    "Who painted The Starry Night in 1889?|Vincent van Gogh|van Gogh;Van Gogh",
    "Who painted Guernica?|Pablo Picasso|Picasso",
    "Who painted The Persistence of Memory, famous for melting clocks?|Salvador Dalí|Salvador Dali;Dali",
    "Who painted Girl with a Pearl Earring?|Johannes Vermeer|Vermeer",
    "Which composer wrote The Four Seasons violin concertos?|Antonio Vivaldi|Vivaldi",
    "Which composer wrote the opera The Magic Flute?|Wolfgang Amadeus Mozart|Mozart",
    "Which composer wrote the ballet Swan Lake?|Pyotr Ilyich Tchaikovsky|Tchaikovsky",
    "Which composer wrote the Brandenburg Concertos?|Johann Sebastian Bach|Bach;JS Bach",
    "What musical term instructs performers to gradually increase volume?|crescendo",
    "How many semitones make up a standard octave in Western equal temperament?|12|twelve",
    "What is the name of the symbol that lowers a musical note by a semitone?|flat|a flat",
    "What family of instruments includes the trumpet, trombone and tuba?|brass|brass instruments",
  ],
  Geography: [
    "What is the capital of New Zealand?|Wellington",
    "What is the capital of Australia?|Canberra",
    "What is the capital of Fiji?|Suva",
    "What is the capital of Papua New Guinea?|Port Moresby",
    "Which river flows through Paris?|Seine|the Seine;Seine River",
    "Which river flows through London?|Thames|the Thames;River Thames",
    "Which river flows through Budapest?|Danube|the Danube;Danube River",
    "Which river flows through Rome?|Tiber|the Tiber;Tiber River",
    "Which is the largest ocean on Earth?|Pacific Ocean|Pacific;the Pacific",
    "Which is the smallest ocean on Earth?|Arctic Ocean|Arctic;the Arctic",
    "What strait separates Spain from Morocco?|Strait of Gibraltar|Gibraltar",
    "What canal connects the Mediterranean Sea to the Red Sea?|Suez Canal|Suez",
  ],
  Canada: [
    "What is the capital of Saskatchewan?|Regina",
    "What is the capital of Nova Scotia?|Halifax",
    "What is the capital of Yukon?|Whitehorse",
    "What is the capital of Nunavut?|Iqaluit",
    "In what year did Canadian Confederation take place?|1867",
    "Who was Canada’s first prime minister?|John A. Macdonald|John Macdonald;Macdonald;Sir John A Macdonald",
    "Which province joined Canada in 1949?|Newfoundland|Newfoundland and Labrador",
    "In what year did Nunavut become a separate Canadian territory?|1999",
    "Who wrote Anne of Green Gables?|Lucy Maud Montgomery|LM Montgomery;L M Montgomery;Montgomery",
    "Which Canadian author wrote The Handmaid’s Tale?|Margaret Atwood|Atwood",
    "Which Canadian author wrote The English Patient?|Michael Ondaatje|Ondaatje",
    "Which Canadian author won the 2013 Nobel Prize in Literature?|Alice Munro|Munro",
  ],
  Sport: [
    "How many players from one team are on the court during ordinary basketball play?|5|five",
    "How many points is a successful basketball free throw worth?|1|one",
    "How high, in feet, is a regulation basketball hoop?|10|ten;10 feet",
    "Who invented basketball in 1891?|James Naismith|Naismith",
    "Which Grand Slam tennis tournament is played on grass courts?|Wimbledon",
    "What word describes a score of zero in tennis?|love",
    "How many points must normally be won to win a tennis tiebreak, provided there is a two-point margin?|7|seven",
    "What name is given to a tennis serve that the receiver cannot touch and that wins the point?|ace|an ace",
    "How many events are in a decathlon?|10|ten",
    "How long, in metres, is one lap of a standard outdoor athletics track measured in lane one?|400|400 metres;400 meters",
    "Which athletics jumping event uses a long flexible pole?|pole vault|pole vaulting",
    "Which swimming stroke uses a simultaneous overarm recovery and a dolphin kick?|butterfly|butterfly stroke",
  ],
};
export const SHORTS: QuestionAtom[] = Object.entries(rows).flatMap(
  ([category, values], categoryIndex) =>
    values.map((row, index) => {
      const [text, answer, aliases] = row.split("|");
      return atom(
        `original-s-${categoryIndex}-${index}`,
        text!,
        answer!,
        category,
        aliases?.split(";"),
      );
    }),
);
// These are authored subject groups (not arbitrary questions grouped at runtime).
const subjects: Record<string, string[]> = {
  Science: ["Chemical elements", "Plant biology", "SI units"],
  Math: ["Geometry", "Number work", "Calculating with formulas"],
  History: ["Germany through time", "Ancient Egypt", "English history"],
  Literature: ["Nineteenth-century novels", "Shakespeare plays", "World literature"],
  Arts: ["Famous paintings", "Classical composers", "Music theory"],
  Geography: ["Oceania capitals", "European rivers", "Seas and waterways"],
  Canada: ["Canadian capitals", "Building Canada", "Canadian authors"],
  Sport: ["Basketball", "Tennis", "Athletics and swimming"],
};
export const GROUPS: QuestionBundle[] = Object.entries(subjects).flatMap(([category, names]) =>
  names.map((title, index) => ({
    id: `original-g-${category}-${index}`,
    format: "open" as const,
    title,
    atoms: SHORTS.filter((q) => q.category === category).slice(index * 4, index * 4 + 4),
  })),
);
const sequences: [string, string, string[][]][] = [
  [
    "Science",
    "List the first four planets in order moving outward from the Sun. Separate your answers with commas.",
    [["Mercury"], ["Venus"], ["Earth"], ["Mars"]],
  ],
  [
    "Math",
    "List the first four prime numbers in ascending order. Separate your answers with commas.",
    [
      ["2", "two"],
      ["3", "three"],
      ["5", "five"],
      ["7", "seven"],
    ],
  ],
  [
    "History",
    "Place these events from earliest to latest: moon landing; French Revolution begins; World War I begins. Separate the event names with commas.",
    [
      ["French Revolution", "French Revolution begins"],
      ["World War I", "World War I begins", "WWI"],
      ["moon landing", "the moon landing"],
    ],
  ],
  [
    "Literature",
    "List the three volumes of The Lord of the Rings in publication order. Separate the titles with commas.",
    [
      ["The Fellowship of the Ring", "Fellowship of the Ring"],
      ["The Two Towers", "Two Towers"],
      ["The Return of the King", "Return of the King"],
    ],
  ],
  [
    "Arts",
    "Name the three primary colours of light in RGB order. Separate your answers with commas.",
    [["red"], ["green"], ["blue"]],
  ],
  [
    "Geography",
    "Place these countries from west to east: India; Portugal; Japan. Separate your answers with commas.",
    [["Portugal"], ["India"], ["Japan"]],
  ],
  [
    "Canada",
    "List the three prairie provinces from west to east. Separate your answers with commas.",
    [["Alberta"], ["Saskatchewan"], ["Manitoba"]],
  ],
  [
    "Sport",
    "List the three triathlon disciplines in standard race order. Separate your answers with commas.",
    [
      ["swimming", "swim"],
      ["cycling", "biking", "bike"],
      ["running", "run"],
    ],
  ],
];
export const SEQUENCES: QuestionAtom[] = sequences.map(([category, text, orderedItems], i) => ({
  ...atom(`original-seq-${i}`, text, orderedItems.map((v) => v[0]).join(", "), category),
  answer: { canonical: orderedItems.map((v) => v[0]).join(", "), aliases: [], orderedItems },
}));
const clues: [string, string, string[], [string, string, string, string]][] = [
  [
    "Science",
    "Saturn",
    [],
    [
      "This planet has a large hexagonal storm near its north pole.",
      "Its largest moon is Titan.",
      "It is the sixth planet from the Sun.",
      "It is famous for a bright, extensive ring system.",
    ],
  ],
  [
    "Math",
    "triangle",
    [],
    [
      "Its medians meet at a centroid.",
      "Its area can be calculated using Heron’s formula.",
      "Its interior angles add to 180 degrees in Euclidean geometry.",
      "It is a polygon with three sides.",
    ],
  ],
  [
    "History",
    "Napoleon Bonaparte",
    ["Napoleon"],
    [
      "This ruler was born in Ajaccio in 1769.",
      "He was exiled first to Elba and then to Saint Helena.",
      "He was defeated at Waterloo in 1815.",
      "He crowned himself Emperor of the French in 1804.",
    ],
  ],
  [
    "Literature",
    "Sherlock Holmes",
    ["Holmes"],
    [
      "This fictional character appears in A Study in Scarlet.",
      "He often stays at 221B Baker Street.",
      "His friend and narrator is Dr. Watson.",
      "He is Arthur Conan Doyle’s famous consulting detective.",
    ],
  ],
  [
    "Arts",
    "piano",
    ["a piano"],
    [
      "This instrument developed from designs by Bartolomeo Cristofori.",
      "Its full historical name refers to playing softly and loudly.",
      "Its hammers strike strings when keys are pressed.",
      "Its standard modern keyboard has 88 keys.",
    ],
  ],
  [
    "Geography",
    "Iceland",
    [],
    [
      "This country’s parliament is called the Althing.",
      "Its geothermal Blue Lagoon is a popular attraction.",
      "Its capital is Reykjavík.",
      "It is a North Atlantic island country whose name suggests frozen water.",
    ],
  ],
  [
    "Canada",
    "beaver",
    ["the beaver", "Canadian beaver"],
    [
      "This animal’s scientific genus is Castor.",
      "It is an engineer of wetland ecosystems.",
      "It has large incisors and a flat tail.",
      "It builds dams and appears on the Canadian five-cent coin.",
    ],
  ],
  [
    "Sport",
    "curling",
    [],
    [
      "In this sport, the playing surface is prepared with small droplets called pebble.",
      "The scoring target is called the house.",
      "Players sweep ahead of a moving stone.",
      "It is an ice sport using granite stones and brooms.",
    ],
  ],
];
export const CLUES: QuestionAtom[] = clues.map(([category, answer, aliases, parts], i) => ({
  ...atom(`original-clue-${i}`, parts[0], answer, category, aliases),
  clues: parts,
}));
