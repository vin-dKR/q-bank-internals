/**
 * An overlay placed on a PDF page. Geometry (`x`, `y`, `w`, `h`) and `fontSize` are in the page's
 * BASE render pixels (the width the page renders at when zoom = 1), so zoom is a pure view scale and
 * export math never depends on it. `x`/`y` are the top-left corner (top-left origin, like the DOM).
 */
export type EditorElementBase = {
  id: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type TextElement = EditorElementBase & {
  type: 'text';
  text: string;
  fontSize: number;
  color: string;
};

export type ImageElement = EditorElementBase & {
  type: 'image';
  dataUrl: string;
};

export type EditorElement = TextElement | ImageElement;
