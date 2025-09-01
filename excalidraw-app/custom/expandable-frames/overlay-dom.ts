// overlay-dom.ts
let __measureCtx: CanvasRenderingContext2D | null = null;

export const setStyle = (
  el: HTMLElement,
  styles: Record<string, string | number>,
) => {
  for (const [k, v] of Object.entries(styles)) {
    (el.style as any)[k] = typeof v === "number" ? String(v) : v;
  }
};

export const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(v, max));

export const measureTextPx = (text: string, fontCss: string) => {
  if (!__measureCtx) {
    __measureCtx = document.createElement("canvas").getContext("2d");
  }
  if (!__measureCtx) return text.length * 7; // safe fallback
  __measureCtx.font = fontCss;
  return Math.ceil(__measureCtx.measureText(text).width);
};

export const svgFrameIcon = () => {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.style.display = "block";
  const rect = document.createElementNS(ns, "rect");
  rect.setAttribute("x", "4");
  rect.setAttribute("y", "6");
  rect.setAttribute("width", "16");
  rect.setAttribute("height", "12");
  rect.setAttribute("rx", "3");
  rect.setAttribute("fill", "none");
  rect.setAttribute("stroke", "currentColor");
  svg.appendChild(rect);
  return svg;
};
