import type { RuleSet } from "@/db/schema";

/** Starter rule packs. Our own wording; applying one appends its rules to a style. */
export const STARTER_PACKS: { id: string; name: string; summary: string; rules: RuleSet }[] = [
  {
    id: "plainspoken",
    name: "Plainspoken",
    summary: "Relaxed, short, like a text from a peer.",
    rules: {
      do: [
        "Write like you would message a peer you respect: short sentences, everyday words.",
        "Keep each message under 40 words.",
        "Use their first name once, at the start.",
        "End with a question that can be answered in one line.",
      ],
      dont: [
        "Use corporate words such as leverage, synergy, solutions or streamline.",
        "Open with a compliment about their profile.",
        "Use exclamation marks.",
      ],
    },
  },
  {
    id: "friendly",
    name: "Friendly",
    summary: "Warm and human without being familiar.",
    rules: {
      do: [
        "Sound like a real person writing one message, not a campaign.",
        "Acknowledge something specific and true about their work before asking anything.",
        "Make it easy to say no.",
      ],
      dont: [
        "Pretend to know them or claim a shared connection that does not exist.",
        "Use flattery that could apply to anyone.",
        "Write more than four short lines.",
      ],
    },
  },
  {
    id: "direct",
    name: "Direct",
    summary: "Gets to the point in the first sentence.",
    rules: {
      do: [
        "State why you are writing in the first sentence.",
        "Use active voice and short, confident sentences.",
        "Ask for one small, specific next step.",
      ],
      dont: [
        "Add pleasantries or preamble before the point.",
        "Hedge with words like just, maybe, I was wondering or quick question.",
        "Stack more than one question in a message.",
      ],
    },
  },
  {
    id: "insight",
    name: "Insight first",
    summary: "Leads with an observation about their situation.",
    rules: {
      do: [
        "Open with one sharp, specific observation about their company or role.",
        "Connect the observation to a problem they probably feel, in their terms.",
        "Use at most two facts about them, and only ones that explain why you are writing.",
      ],
      dont: [
        "Paraphrase their headline or company tagline back to them.",
        "Describe the product before the problem is clear.",
        "Invent facts about them or their company.",
      ],
    },
  },
  {
    id: "evidence",
    name: "Evidence led",
    summary: "Earns trust with a concrete result.",
    rules: {
      do: [
        "Use one concrete proof point with a number or a named type of customer.",
        "Explain briefly how the result was achieved.",
        "Keep claims modest and checkable.",
      ],
      dont: [
        "Fabricate a result, customer or case study.",
        "Guarantee meetings, leads or revenue.",
        "List more than one proof point in a message.",
      ],
    },
  },
];
