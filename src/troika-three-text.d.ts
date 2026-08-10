// troika-three-text ships no type declarations and no @types package exists.
// This covers only the surface this project actually uses.
declare module "troika-three-text" {
  import type { Mesh } from "three";

  export class Text extends Mesh {
    text: string;
    font: string | undefined;
    fontSize: number;
    color: number | string;
    anchorX: "left" | "center" | "right" | number;
    anchorY: "top" | "top-baseline" | "middle" | "bottom-baseline" | "bottom" | number;
    letterSpacing: number;
    outlineWidth: number | string;
    fillOpacity: number;
    maxWidth: number;
    sync(callback?: () => void): void;
    dispose(): void;
  }

  export function configureTextBuilder(config: {
    defaultFontURL?: string;
    unicodeFontsURL?: string;
    sdfGlyphSize?: number;
  }): void;
}
