import { z } from "zod";

export const FORMATS = [
  "tossup",
  "snapper",
  "open",
  "sequence",
  "team",
  "assigned",
  "clues",
  "shootout",
] as const;
export type Format = (typeof FORMATS)[number];
export const FORMAT_LABELS: Record<Format, string> = {
  tossup: "Tossup",
  snapper: "Snapper",
  open: "Open questions",
  sequence: "Sequence",
  team: "Team scramble",
  assigned: "Assigned",
  clues: "Who / What am I?",
  shootout: "Shootout",
};
export type Team = "A" | "B";
export const CATEGORIES = [
  "Science",
  "Math",
  "History",
  "Literature",
  "Arts",
  "Geography",
  "Canada",
  "Sport",
  "General",
  "Entertainment",
  "Religion",
  "Mythology",
  "Philosophy",
  "Social Science",
] as const;
export const configSchema = z
  .object({
    mode: z.enum(["ffa", "teams"]),
    formats: z
      .array(z.enum(FORMATS))
      .min(1)
      .max(8)
      .refine((v) => new Set(v).size === v.length),
    categories: z.array(z.enum(CATEGORIES)).min(1).max(CATEGORIES.length),
    difficulty: z.enum(["easy", "medium", "hard", "unrated", "any"]),
    language: z.literal("en"),
    source: z.enum(["mixed", "bundled"]),
    wpm: z.number().int().min(80).max(500),
    shortProgressive: z.boolean(),
    answerMs: z.number().int().min(3000).max(60000),
    sequenceMs: z.number().int().min(5000).max(120000),
    graceMs: z.number().int().min(1000).max(30000),
    revealMs: z.number().int().min(1000).max(60000),
    autoAdvance: z.boolean(),
    negs: z.boolean(),
    points: z
      .object({
        regular: z.number().int().min(1).max(100),
        power: z.number().int().min(1).max(200),
        penalty: z.number().int().min(-100).max(0),
        sequence: z.number().int().min(1).max(200),
        clues: z.tuple([
          z.number().int().min(1).max(200),
          z.number().int().min(1).max(200),
          z.number().int().min(1).max(200),
          z.number().int().min(1).max(200),
        ]),
      })
      .strict(),
  })
  .strict();
export type RoomConfig = z.infer<typeof configSchema>;
export const DEFAULT_CONFIG: RoomConfig = {
  mode: "ffa",
  formats: [...FORMATS],
  categories: ["Science", "Math", "History", "Literature", "Arts", "Geography", "Canada", "Sport"],
  difficulty: "medium",
  language: "en",
  source: "mixed",
  wpm: 210,
  shortProgressive: true,
  answerMs: 8000,
  sequenceMs: 20000,
  graceMs: 2800,
  revealMs: 5200,
  autoAdvance: true,
  negs: false,
  points: { regular: 10, power: 15, penalty: -5, sequence: 20, clues: [40, 30, 20, 10] },
};

export interface Provenance {
  label: string;
  url?: string;
  license: string;
  authors?: string;
}
export interface AnswerSpec {
  canonical: string;
  aliases: string[];
  promptAliases?: string[];
  rejects?: string[];
  orderedItems?: string[][];
}
/** Server-only content. Never import a content bank into a client component. */
export interface QuestionAtom {
  id: string;
  text: string;
  answer: AnswerSpec;
  category: string;
  difficulty: "easy" | "medium" | "hard" | "unrated";
  language: "en";
  provenance: Provenance;
  /** Visible character offset at which the power window ends. */
  powerAt?: number;
  clues?: [string, string, string, string];
}
export interface QuestionBundle {
  id: string;
  format: Format;
  title: string;
  atoms: QuestionAtom[];
}
export interface PlayerView {
  id: string;
  name: string;
  team: Team | null;
  score: number;
  role: "player" | "spectator";
  connected: boolean;
  owner: boolean;
  moderator: boolean;
  /** Retained score/history row after session access has been revoked. */
  removed?: boolean;
}
export interface AttemptView {
  id: string;
  playerId: string;
  name: string;
  answer: string;
  verdict: "accept" | "reject" | "prompt";
  points: number;
  corrected: boolean;
}
export interface ChatMessage {
  id: string;
  playerId: string;
  name: string;
  text: string;
  at: number;
}
export interface PublicQuestion {
  id: string;
  text: string;
  category: string;
  format: Format;
  readingComplete: boolean;
  answer: string | null;
  provenance: Provenance | null;
  clueNumber: number | null;
  sequenceLength: number | null;
}
export interface PendingAdmission {
  id: string;
  name: string;
  role: "player" | "spectator";
  requestedAt: number;
}
export interface SessionView {
  sessionId: string;
  revision: number;
  serverTime: number;
  selfId: string;
  config: RoomConfig;
  pendingConfig: RoomConfig | null;
  phase: "waiting" | "reading" | "answering" | "reveal";
  pausedReasons: string[];
  players: PlayerView[];
  teamScores: Record<Team, number>;
  block: {
    id: string;
    format: Format;
    title: string;
    index: number;
    count: number;
    rosterIds: string[];
  } | null;
  question: PublicQuestion | null;
  attempts: AttemptView[];
  chat: ChatMessage[];
  deadline: number | null;
  answererId: string | null;
  /** Identifies one answer attempt, including a separate clarification window. */
  answerWindowId: string | null;
  /** Unsubmitted player text, relayed transiently by the coordinator. */
  answerDraft: string;
  eligibleIds: string[];
  canBuzz: boolean;
  canAnswer: boolean;
  canModerate: boolean;
  needsBlock: boolean;
  challenge: { playerId: string; name: string } | null;
  pendingAdmissions: PendingAdmission[];
  notice: string | null;
}
export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("buzz") }).strict(),
  z.object({ type: z.literal("answer"), text: z.string().trim().min(1).max(500) }).strict(),
  z.object({ type: z.literal("chat"), text: z.string().trim().min(1).max(500) }).strict(),
  z.object({ type: z.literal("team"), team: z.enum(["A", "B"]) }).strict(),
  z
    .object({ type: z.literal("take-seat"), team: z.enum(["A", "B"]).nullable().optional() })
    .strict(),
  z.object({ type: z.literal("spectate") }).strict(),
  z.object({ type: z.literal("start") }).strict(),
  z.object({ type: z.literal("next") }).strict(),
  z.object({ type: z.literal("pause") }).strict(),
  z.object({ type: z.literal("resume") }).strict(),
  z.object({ type: z.literal("skip") }).strict(),
  z.object({ type: z.literal("end-block") }).strict(),
  z.object({ type: z.literal("reset-scores") }).strict(),
  z.object({ type: z.literal("challenge") }).strict(),
  z.object({ type: z.literal("resolve-challenge") }).strict(),
  z
    .object({
      type: z.literal("correct"),
      attemptId: z.string().max(100),
      verdict: z.enum(["accept", "reject"]),
    })
    .strict(),
  z.object({ type: z.literal("configure"), config: configSchema }).strict(),
  z
    .object({ type: z.literal("promote"), playerId: z.string().max(100), moderator: z.boolean() })
    .strict(),
  z.object({ type: z.literal("kick"), playerId: z.string().max(100) }).strict(),
  z.object({ type: z.literal("approve"), requestId: z.string().max(100) }).strict(),
  z.object({ type: z.literal("reject"), requestId: z.string().max(100) }).strict(),
  z.object({ type: z.literal("close-session") }).strict(),
]);
export type GameAction = z.infer<typeof actionSchema>;
export const commandSchema = z
  .object({
    id: z.string().min(1).max(100),
    sessionId: z.string().min(1).max(100),
    questionId: z.string().max(100).nullable(),
    action: actionSchema,
  })
  .strict();
export type ClientCommand = z.infer<typeof commandSchema>;
export const ANSWER_DRAFT_INTERVAL_MS = 200;
export const answerDraftSchema = z
  .object({
    type: z.literal("answer-draft"),
    sessionId: z.string().min(1).max(100),
    questionId: z.string().min(1).max(100),
    answerWindowId: z.string().min(1).max(250),
    text: z.string().max(500),
  })
  .strict();
export type AnswerDraftMessage = z.infer<typeof answerDraftSchema>;
export type ServerMessage =
  | { type: "state"; state: SessionView }
  | AnswerDraftMessage
  | {
      type: "reading";
      questionId: string;
      text: string;
      readingComplete: boolean;
      serverTime: number;
    }
  | { type: "error"; message: string; commandId?: string }
  | { type: "ended"; message: string }
  | { type: "replaced"; message: string }
  | { type: "ack"; commandId: string };
export interface SiteStatus {
  owner: boolean;
  ownerConfigured: boolean;
  devAuth: boolean;
  active: boolean;
  sessionId: string | null;
  config: RoomConfig;
  admission: "none" | "pending" | "approved" | "rejected";
  message?: string;
}
