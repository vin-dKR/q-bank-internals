/**
 * Diagram-detection prompt, ported from the Python image-auto-cropper
 * (`backend/services/openai_detector.py`). Kept faithful to the original wording — vision models are
 * sensitive to phrasing, and this exact prompt is what produces tight per-question bounding boxes.
 */
export function detectorPrompt(imgWidth: number, imgHeight: number): string {
  return `You are an expert OCR and layout-analysis system for scanned examination papers.

The attached image is a question paper. Its pixel dimensions are ${String(imgWidth)} px wide × ${String(imgHeight)} px tall.

=============================
TASK: DETECT DIAGRAMS
=============================
1. Identify every question by its number (1, 2, 3 … or Q1, Q2 …).
2. For each question, detect if there is an associated GRAPHICAL ELEMENT (diagram, figure, graph, illustration, or shape).
3. Provide a TIGHT bounding box around only the visual/graphical pixels of that element.

CORE RULES:
  1. The bbox MUST correspond to the ACTUAL POSITION of the diagram/drawing in the image.
  2. The bbox must NOT include question text, numbers, or option labels unless they are integral parts of the drawing.
  3. Do NOT simply box the question label area; you must find the graphic itself wherever it is located in the original image.
  4. If a question has no diagram or graphic, set has_image=false and bbox=null.
  5. If a question has a diagram, set has_image=true and provide the bbox.

=============================
BOUNDING BOX FORMAT
=============================
[x, y, width, height]  — integers, pixel coords relative to the full image
  x      = left  edge  (0 … ${String(imgWidth)})
  y      = top   edge  (0 … ${String(imgHeight)})
  width  = box width   (x + width  ≤ ${String(imgWidth)})
  height = box height  (y + height ≤ ${String(imgHeight)})

=============================
OUTPUT FORMAT
=============================
Return a JSON object with a single "detections" array in this exact shape — no prose, no markdown:
{
  "detections": [
    {"q_no": 1, "has_image": false, "bbox": null},
    {"q_no": 2, "has_image": true,  "bbox": [x, y, w, h]}
  ]
}`;
}
