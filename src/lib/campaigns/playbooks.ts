import type { SequenceStep } from "@/db/schema";

/**
 * Outreach strategies. Each sets a default step list and a short brief that message
 * drafting follows (used from Phase 6). Our own names and wording.
 */
export type Playbook = {
  id: string;
  name: string;
  summary: string;
  brief: string;
  example: string[];
  waits: number[]; // wait days for each message step after the invite
};

export const PLAYBOOKS: Playbook[] = [
  {
    id: "curiosity",
    name: "Curiosity",
    summary: "Point out something unresolved, then explain it.",
    brief:
      "Open with a real, specific observation about their situation that raises a question they would want answered. Do not answer it in the opener. Follow-up 1 explains what is behind the observation, how it is solved, and one proof point. The last note adds a consequence of the same insight instead of repeating it. Never manufacture a fake tease.",
    example: [
      "Opener: an observation that leaves a question open.",
      "Follow-up 1: the explanation, the fix, one proof point, a real question.",
      "Last note: a useful consequence of the same idea, then a polite exit.",
    ],
    waits: [1, 3, 4],
  },
  {
    id: "plain",
    name: "Plain ask",
    summary: "Honest and casual, with very small asks.",
    brief:
      "Say plainly who you are and why you are writing, in the fewest words. Each message asks for something tiny and easy to answer. No clever hooks. Follow-up 1 gives the price and one proof point; the last note offers the free offer if there is one and makes it easy to say no.",
    example: [
      "Opener: who you are, why them, a one-line question.",
      "Follow-up 1: what it costs and one result.",
      "Last note: the free offer, or a friendly sign-off.",
    ],
    waits: [1, 3, 4],
  },
  {
    id: "specific",
    name: "Specific to them",
    summary: "Lead with something precise about them, then help.",
    brief:
      "Every message must contain something that could only be written to this person: their role, their company's situation, their market. Open with that specific point and why it matters to them. Follow-up 1 shows how others in the same position solved it, with one proof point. The last note offers concrete help.",
    example: [
      "Opener: one precise fact about them and why it matters.",
      "Follow-up 1: how a similar company handled it, with a result.",
      "Last note: a concrete offer of help.",
    ],
    waits: [1, 3, 4],
  },
  {
    id: "custom",
    name: "Custom",
    summary: "Start from an empty sequence and build your own.",
    brief: "",
    example: ["Add the steps you want."],
    waits: [],
  },
];

export function playbookById(id: string) {
  return PLAYBOOKS.find((p) => p.id === id) ?? PLAYBOOKS[0];
}

export function defaultSteps(playbookId: string): SequenceStep[] {
  const pb = playbookById(playbookId);
  return [
    { id: crypto.randomUUID(), type: "invite", waitDays: 0, mode: "blank", template: "", fallback: "" },
    ...pb.waits.map(
      (w): SequenceStep => ({ id: crypto.randomUUID(), type: "message", waitDays: w, mode: "ai", template: "", fallback: "" }),
    ),
  ];
}
