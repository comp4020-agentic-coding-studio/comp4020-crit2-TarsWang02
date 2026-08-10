import { createScene } from "./src/scene";
import { setupEyeTransition } from "./src/eye";
import { setupScrollReveals } from "./src/reveals";
import { papers } from "./src/papers";

const canvas = document.querySelector<HTMLCanvasElement>("#flow-field");
if (canvas) {
  createScene(canvas);
}

setupEyeTransition();

const depth = document.querySelector<HTMLElement>("#depth");
if (depth) {
  for (const paper of papers) {
    const article = document.createElement("article");
    article.className = "paper-card";

    const heading = document.createElement("h2");
    heading.textContent = paper.title;

    const note = document.createElement("p");
    note.textContent = paper.note;

    const citation = document.createElement("p");
    citation.className = "citation";
    const link = document.createElement("a");
    link.href = `https://arxiv.org/abs/${paper.arxiv}`;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = `arXiv:${paper.arxiv} · ${paper.year}`;
    citation.append(link);

    article.append(heading, note, citation);
    depth.append(article);
  }
}

setupScrollReveals();
