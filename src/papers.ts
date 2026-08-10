// Real DeepSeek research, listed (without commentary) on the current site's
// footer at deepseek.com. Titles are quoted verbatim — a title is a fact, not
// an expressive work. `note` is written from scratch from the papers' public
// facts (parameter counts, architecture, training scale), not copied from any
// abstract, per the spec's "restructured and rewritten, not pasted wholesale."
// Sources cited in PROCESS.md.
export interface Paper {
  title: string;
  arxiv: string;
  year: number;
  note: string;
}

export const papers: Paper[] = [
  {
    title: "DeepSeek LLM: Scaling Open-Source Language Models with Longtermism",
    arxiv: "2401.02954",
    year: 2024,
    note: "7B and 67B dense models trained on 2 trillion tokens, built to test scaling laws rather than chase one benchmark.",
  },
  {
    title:
      "DeepSeek-Coder: When the Large Language Model Meets Programming — The Rise of Code Intelligence",
    arxiv: "2401.14196",
    year: 2024,
    note: "Trained on repository-level context, files ordered by their real import dependencies instead of read in isolation.",
  },
  {
    title: "DeepSeekMath: Pushing the Limits of Mathematical Reasoning in Open Language Models",
    arxiv: "2402.03300",
    year: 2024,
    note: "Introduced Group Relative Policy Optimization, comparing sampled answers against each other instead of training a separate value network.",
  },
  {
    title: "DeepSeek-VL: Towards Real-World Vision-Language Understanding",
    arxiv: "2403.05525",
    year: 2024,
    note: "A hybrid SigLIP and SAM vision encoder feeding a 1.3B or 7B language backbone, built for real interfaces, not just benchmark images.",
  },
  {
    title: "DeepSeek-V2: A Strong, Economical, and Efficient Mixture-of-Experts Language Model",
    arxiv: "2405.04434",
    year: 2024,
    note: "236 billion parameters, 21 billion active per token. Multi-head Latent Attention compresses the key-value cache by over 93 percent.",
  },
  {
    title: "DeepSeek-Coder-V2: Breaking the Barrier of Closed-Source Models in Code Intelligence",
    arxiv: "2406.11931",
    year: 2024,
    note: "Extended from V2 with 6 trillion more tokens, widening support from 86 to 338 programming languages.",
  },
  {
    title: "DeepSeek-V3 Technical Report",
    arxiv: "2412.19437",
    year: 2024,
    note: "671 billion total parameters, 37 billion activated per token — a 5.5 percent activation ratio across 256 routed experts.",
  },
  {
    title: "DeepSeek-R1: Incentivizing Reasoning Capability in LLMs via Reinforcement Learning",
    arxiv: "2501.12948",
    year: 2025,
    note: "Reasoning trained through reinforcement learning alone, with no supervised chain-of-thought dataset to imitate first.",
  },
];
