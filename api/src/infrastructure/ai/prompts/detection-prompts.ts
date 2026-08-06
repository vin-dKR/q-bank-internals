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
3. Provide a TIGHT bounding box around only the visual/graphical pixels of that element. Trace the
   outermost ink of the diagram (including its labels only when they are part of the diagram), then add
   at most 4 pixels of padding. Do not include surrounding whitespace, question prose, answer text,
   option labels, page decorations, or another nearby diagram.
4. For every question that HAS a diagram, also copy the first line of that question's text verbatim
   (the words right after the question number, up to ~12 words) into "question_text". This is used to
   attach the cropped figure to the correct question, so transcribe it exactly as printed.
5. Separately, for EVERY numbered question on the page (whether or not it has a diagram), report its
   position: "y_top" = the vertical pixel (0 … ${String(imgHeight)}) of the TOP of that question's
   first line, and "x_left" = the horizontal pixel (0 … ${String(imgWidth)}) of the LEFT edge of the
   question number. A cropped figure is attached to the question directly above it in the SAME COLUMN
   using these values, so on a two-column page x_left must correctly place each question in its column.

CORE RULES:
  1. The bbox MUST correspond to the ACTUAL POSITION of the diagram/drawing in the image.
  2. The bbox must NOT include question text, numbers, or option labels unless they are integral parts of the drawing.
  3. Do NOT simply box the question label area; you must find the graphic itself wherever it is located in the original image.
  4. If a question has no diagram or graphic, set has_image=false and bbox=null.
  5. If a question has a diagram, set has_image=true and provide the bbox.
  6. Set "target" to "question" when the diagram belongs to the question stem, or "option" when it
     belongs inside an answer choice. For option figures, set "option_label" to that choice's printed
     label (for example "A"); otherwise use null.

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
Return a JSON object with two arrays — "questions" and "detections" — in this exact shape, no prose,
no markdown. "questions" lists every numbered question with its "y_top"; "detections" lists the
diagrams. "question_text" may be "" for questions with no diagram:
{
  "questions": [
    {"q_no": 1, "x_left": 60, "y_top": 140},
    {"q_no": 2, "x_left": 60, "y_top": 512}
  ],
  "detections": [
    {"q_no": 1, "has_image": false, "bbox": null, "question_text": ""},
    {"q_no": 2, "has_image": true, "target": "question", "option_label": null, "bbox": [x, y, w, h], "question_text": "If |P| = 20, then P in cartesian form is"},
    {"q_no": 3, "has_image": true, "target": "option", "option_label": "B", "bbox": [x, y, w, h], "question_text": ""}
  ]
}`;
}
