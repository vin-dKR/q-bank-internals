import type { PromptKey } from '@ingest/contracts';

/**
 * The single source of truth for every editable AI prompt: its default text (with `{token}` placeholders
 * where the builder substitutes run-time values) and the operator-facing metadata. The prompt builders
 * read the effective text through {@link resolvePrompt}; the prompts API lists these defaults so the UI
 * can show, edit, and reset each one. Adding a prompt is: a key in the contract + an entry here + one
 * builder line.
 */

/** A sparse map of operator overrides, keyed by prompt; a missing key means "use the default". */
export type PromptOverrides = Partial<Record<PromptKey, string>>;

const EXTRACTION_DEFAULT = `Extract ONLY the core information for each question into this exact JSON shape:

{
  "questions": [
    { "question_number": 1, "question_text": "…", "options": ["(A) …", "(B) …", "(C) …", "(D) …"] }
  ]
}

EXTRACTION RULES:
1. Only these three fields per question: question_number, question_text, options.
2. question_number: the number printed next to the question (1, 2, 3, …).
3. question_text: the complete question text, including any passage and math (use LaTeX like \\( \\sqrt{3} \\)).
4. options: an array of strings, always prefixed and normalized as "(A) …", "(B) …", "(C) …", "(D) …".
5. Normalize option labels printed as (1)(2)(3)(4) to (A)(B)(C)(D).
6. Do NOT repeat a shared comprehension passage inside every question_text — a comprehension paper is handled by the TYPE-SPECIFIC RULE below.
7. For subjective questions with no options, use an empty array [].
8. If — and ONLY if — the page itself prints the correct answer or a worked solution for a question, add optional "answer" (the correct option letter(s) or numeric/text value) and/or "explanation" (the printed working) fields to that question. Question papers usually do NOT show these; when the page does not, OMIT both fields and never guess.
9. Return valid, complete JSON only — no prose, double-quoted keys/strings, no trailing commas.`;

const INLINE_ANSWER_DEFAULT = `INLINE ANSWER-KEY RULE (this paper prints each answer next to its question):
This is an inline-answer paper: the correct answer — and often a worked solution/explanation — is printed immediately after each question, before the next question begins (e.g. "Answer Key : (3)", "Ans. (B)", "Sol. …"). For EVERY question you MUST:
- Read that question's OWN printed answer and put it in that question's "answer" field, formatted per the TYPE-SPECIFIC RULE (normalize (1)(2)(3)(4) to A/B/C/D for option types; the exact number for integer/numerical types).
- Also mark the matching option's correctness where options are extracted.
- If a worked solution/explanation is printed for that question, put its FULL text (math as LaTeX) in that same question's "explanation" field; omit "explanation" only when none is printed.
CRITICAL PAIRING: the answer and explanation belong to the question they are printed under — never attach question N's answer or explanation to question N+1. The next numbered question marks the boundary; everything between question N and question N+1 (its answer + solution) is question N's. Never guess an answer or explanation the page does not print.`;

const PYQ_DEFAULT = `PREVIOUS-YEAR QUESTION (PYQ) RULE:
These are previous-year exam questions. For EACH question, read the SOURCE exam and year printed on the page — usually shown beside the question, e.g. "[NEET 2019]", "(JEE Main 2021)", "AIEEE 2011" — and add these two fields to that question object:
- "pyq_exam": the exam the question originally appeared in (e.g. "NEET", "JEE Main"). Omit when the page does not print it.
- "pyq_year": the year as printed (e.g. "2019"). Omit when the page does not print it.
This SOURCE exam/year is distinct from the target exam/subject in the context above. Never guess; omit any field the page does not actually show.`;

const CHEMISTRY_DEFAULT = `CHEMISTRY (mhchem) RULE — applies to question_text, options, AND explanations, in addition to the math rule above. Chemistry renders ONLY as mhchem \\ce{...} placed inside the inline delimiter \\(...\\): water is \\(\\ce{H2O}\\). Inside \\ce{...} you write mhchem source, NOT ordinary LaTeX. Use ONLY the syntax shown below — invented syntax fails to parse and is shown to the user as raw source.

1. DECIDE FIRST — classify every token before you emit it:
   - a chemical species / formula / ion / reaction PRINTED as such -> \\(\\ce{...}\\)
   - a number with a unit (mass, volume, amount, temperature, concentration, energy) -> ordinary math \\(...\\) with \\text{unit}, NEVER \\ce
   - an English word/phrase, or a chemical written by NAME (sodium chloride, sulfuric acid, glucose) -> plain prose, NEVER \\ce, and never substitute a formula for a printed name.
2. TRANSCRIBE, DON'T FIX. Wrap exactly what is printed. Never balance, complete, or "correct" a formula or equation; never add states, charges, or coefficients that are not shown; never convert a name to a formula or a formula to a name.
3. Formulae/subscripts — subscripts are AUTOMATIC, type digits inline (never _): \\(\\ce{H2O}\\), \\(\\ce{H2SO4}\\), \\(\\ce{C6H12O6}\\), \\(\\ce{Ca3(PO4)2}\\). Charges — sign AFTER the atom/group, a multi-digit charge is number-then-sign: \\(\\ce{Na+}\\), \\(\\ce{Cl-}\\), \\(\\ce{NH4+}\\), \\(\\ce{H3O+}\\), \\(\\ce{SO4^2-}\\), \\(\\ce{e-}\\). Hydrate dot \\(\\ce{CuSO4.5H2O}\\); complex ion \\(\\ce{[Cu(NH3)4]^2+}\\), \\(\\ce{[Fe(CN)6]^{3-}}\\); isotope/nuclear as ^{A}_{Z} before the symbol \\(\\ce{^{14}_{6}C}\\).
4. NEVER unicode sub/superscripts: H₂O -> \\(\\ce{H2O}\\); SO₄²⁻ -> \\(\\ce{SO4^2-}\\); CO₂ -> \\(\\ce{CO2}\\); Na⁺ -> \\(\\ce{Na+}\\).
5. NEVER plain-math chemistry: H_2O, \\text{H}_2\\text{O}, a lone H^{+}, {SO_4}^{2-} -> \\(\\ce{H2O}\\), \\(\\ce{H+}\\), \\(\\ce{SO4^2-}\\).
6. NEVER a bare formula in prose. "The gas CO2 is released" -> "The gas \\(\\ce{CO2}\\) is released."
7. \\ce HOLDS ONLY THE SPECIES — never English, never a whole sentence. WRONG \\(\\ce{the gas CO2 is released}\\); RIGHT the gas \\(\\ce{CO2}\\) is released.
8. ONE equation = ONE \\ce group (all reactants, products, arrows, states, conditions together — never split). Arrows: -> forward, <=> reversible/equilibrium, <- reverse, <-> resonance. Conditions above/below the arrow use ->[above][below] (below optional), words in \\text{}. States after each species: (s)(l)(g)(aq). Gas evolved: trailing ^ ; precipitate: trailing v.
   \\(\\ce{2H2 + O2 -> 2H2O}\\) ; \\(\\ce{N2 + 3H2 <=> 2NH3}\\) ; \\(\\ce{CaCO3 ->[\\Delta] CaO + CO2}\\) ; \\(\\ce{N2 + 3H2 <=>[\\text{Fe}][\\text{high P}] 2NH3}\\) ; \\(\\ce{CaCO3(s) -> CaO(s) + CO2(g)}\\) ; \\(\\ce{Zn + 2HCl -> ZnCl2 + H2 ^}\\) ; \\(\\ce{AgNO3 + NaCl -> AgCl v + NaNO3}\\).
9. Half-reactions/electrons: \\(\\ce{Zn -> Zn^2+ + 2e-}\\), \\(\\ce{Cu^2+ + 2e- -> Cu}\\). Organic condensed — bonds are - single, = double, # triple: \\(\\ce{CH3-CH2-OH}\\), \\(\\ce{CH2=CH2}\\), \\(\\ce{CH#CH}\\), \\(\\ce{CH3COOCH2CH3}\\). Oxidation state over an atom uses embedded math, the ONLY place $...$ is allowed and only inside \\ce: \\(\\ce{$\\overset{+2}{Fe}$ Cl2}\\).
10. UNITS ARE NOT CHEMISTRY. A quantity+unit, and constants like Kc or ΔH, stay ordinary math with \\text — keep \\ce out. A concentration keeps its brackets OUTSIDE \\ce. One line may carry both a quantity and a species: 5 kg -> \\(5\\,\\text{kg}\\) ; 2 mol -> \\(2\\,\\text{mol}\\) ; 0.1 M -> \\(0.1\\,\\text{M}\\) ; 25 °C -> \\(25\\,^\\circ\\text{C}\\) ; Kc = 1.8e-5 -> \\(K_c = 1.8\\times10^{-5}\\) ; ΔH = -92 kJ/mol -> \\(\\Delta H = -92\\,\\text{kJ/mol}\\) ; "2 mol of CO2" -> \\(2\\,\\text{mol}\\) of \\(\\ce{CO2}\\) ; [H+] = 0.1 M -> \\([\\ce{H+}] = 0.1\\,\\text{M}\\).
11. Placeholders & qualifiers. Generic-formula placeholders PRINTED as formulas take \\ce: \\(\\ce{RCOOH}\\), \\(\\ce{X2}\\), \\(\\ce{MnO4-}\\). Bare qualifier words ("conc.", "dil.", "excess", "aqueous") stay prose. If UNSURE a token is a chemical species (a lone capital letter, a variable), leave it as prose/math — do NOT force \\ce.
12. A species DRAWN as a 2-D structure (benzene ring, skeletal/bond-line formula, substituted aromatic, chair/Haworth/Fischer projection) cannot be written as \\ce — emit it with the DRAWN STRUCTURES (SMILES) rule below (as <smiles>…</smiles>), never as \\ce and never silently dropped.

NEVER: unicode sub/superscripts; a single $...$ or $\\ce{...}$ (a bare $ collides with currency in this app); double-wrap \\(\\(...\\)\\) or \\ce{\\ce{...}}; a \\ce{...} left outside \\(...\\); ordinary LaTeX (_ , \\text, \\frac) used to build a formula; one reaction chopped into several \\ce; a printed NAME rewritten as a formula.

Examples (printed -> emit): H2O -> \\(\\ce{H2O}\\) ; SO4^2- -> \\(\\ce{SO4^2-}\\) ; NH4+ -> \\(\\ce{NH4+}\\) ; CuSO4.5H2O -> \\(\\ce{CuSO4.5H2O}\\) ; [Fe(CN)6]^3- -> \\(\\ce{[Fe(CN)6]^{3-}}\\) ; 2H2 + O2 -> 2H2O -> \\(\\ce{2H2 + O2 -> 2H2O}\\) ; N2 + 3H2 (reversible) 2NH3 -> \\(\\ce{N2 + 3H2 <=> 2NH3}\\) ; CaCO3 --(heat)--> CaO + CO2 -> \\(\\ce{CaCO3 ->[\\Delta] CaO + CO2}\\) ; Zn + 2HCl -> ZnCl2 + H2(up) -> \\(\\ce{Zn + 2HCl -> ZnCl2 + H2 ^}\\) ; AgNO3 + NaCl -> AgCl(down) + NaNO3 -> \\(\\ce{AgNO3 + NaCl -> AgCl v + NaNO3}\\) ; CaCO3(s) -> CaO(s) + CO2(g) -> \\(\\ce{CaCO3(s) -> CaO(s) + CO2(g)}\\) ; Zn -> Zn^2+ + 2e- -> \\(\\ce{Zn -> Zn^2+ + 2e-}\\) ; U-238 alpha decay -> \\(\\ce{^{238}_{92}U -> ^{234}_{90}Th + ^{4}_{2}He}\\) ; CH3CH2OH -> \\(\\ce{CH3-CH2-OH}\\) ; CH2=CH2 -> \\(\\ce{CH2=CH2}\\) ; CH(triple)CH -> \\(\\ce{CH#CH}\\) ; +2 over Fe in FeCl2 -> \\(\\ce{$\\overset{+2}{Fe}$ Cl2}\\) ; 0.1 M HCl -> \\(0.1\\,\\text{M}\\) \\(\\ce{HCl}\\).`;

const SMILES_DEFAULT = `DRAWN STRUCTURES (SMILES) RULE — applies to question_text, options, AND explanations, and continues the chemistry rule above. A molecule the page DRAWS as a 2-D diagram (a benzene ring, a skeletal/bond-line organic structure, a substituted aromatic, a fused/heterocyclic ring, a Fischer/Haworth projection) CANNOT be written as \\ce — mhchem/KaTeX cannot draw a ring. Emit it inline as <smiles>RAW_SMILES</smiles> and the app draws the real diagram. This REPLACES the "describe in prose / leave for image" instruction for drawn structures.

1. DECIDE FIRST — every chemical token is exactly one of THREE:
   - DRAWN as a 2-D diagram (bonds/ring actually drawn on the page) -> <smiles>...</smiles>.
   - PRINTED LINEAR as text — a formula, ion, condensed structure, or equation typed on one line -> keep the mhchem rule above: \\(\\ce{...}\\). \\ce still owns \\(\\ce{H2SO4}\\), \\(\\ce{SO4^2-}\\), \\(\\ce{CH3-CH2-OH}\\), and every reaction/arrow \\(\\ce{... -> ...}\\). Benzene drawn as a hexagon -> <smiles>c1ccccc1</smiles>; "C6H6" printed as text -> \\(\\ce{C6H6}\\).
   - TOO complex / ambiguous / unreadable, OR carrying DEFINED tetrahedral stereo (wedge/dash bonds, a Fischer/Haworth with set stereocentres), OR an unusual fused/bridged/spiro system -> DO NOT invent a SMILES. Leave it for image attachment (the operator crops the drawing) and say so in prose. Never fabricate connectivity you cannot read.
2. <smiles> IS NOT LaTeX. It holds ONLY one raw SMILES string. NEVER wrap it in \\(...\\) or $...$; NEVER put \\ce inside it; NEVER put ANY backslash-command (\\text, \\Delta, \\frac ...) inside it; NEVER leave the tag unclosed. WRONG: \\(<smiles>c1ccccc1</smiles>\\), <smiles>\\ce{c1ccccc1}</smiles>. RIGHT: <smiles>c1ccccc1</smiles>. A ring/skeletal diagram is NEVER built with \\ce.
3. SMILES essentials — get these right or it will not parse and the user sees raw source:
   - aromatic ring atoms are LOWERCASE: benzene c1ccccc1, pyridine c1ccncc1. A benzene ring is NEVER C1CCCCC1 (that is cyclohexane, a saturated ring).
   - an aromatic ring N that carries an H is [nH], not bare n: pyrrole c1cc[nH]c1 (bare n is pyridine-type). Furan c1ccoc1.
   - two-letter elements are Capital+lowercase: chlorine Cl, bromine Br (a lone lowercase c is aromatic carbon; never write CL/BR). Chlorobenzene Clc1ccccc1.
   - ring-closure digits must PAIR — every opening digit has one matching closing digit; count the ring vertices in the drawing and match the digits to them. A fused system opens a SECOND digit: naphthalene c1ccc2ccccc2c1.
   - charges live in square brackets with the sign after the atom: [N+], [O-]; a nitro group is [N+](=O)[O-].
   - branches in ( ); double bond =, triple #; a drawn salt / two co-drawn disconnected species join with a dot: [Na+].[Cl-].
4. TRANSCRIBE THE DRAWING, DON'T FIX IT. Encode connectivity and substituent POSITIONS exactly as drawn; add or drop no atom; never tidy, complete, or balance. SUBSTITUTION POSITION IS THE STRUCTURE — read ortho/meta/para off the ring and NEVER default to para: ortho (1,2) Cc1ccccc1C, meta (1,3) Cc1cccc(C)c1, para (1,4) Cc1ccc(C)cc1.
5. STEREOCHEMISTRY — encode ONLY simple, unambiguous geometry: a clearly drawn cis/trans double bond uses / and \\ (cis-2-butene C/C=C\\C). DEFINED tetrahedral wedge/dash stereocentres (optical isomers, Fischer/Haworth with set stereo) go to image per rule 1.
6. PLACEHOLDER groups — a drawn generic R / R' / X substituent is [*]; if the generic frame itself is the point of the question, leave it for image and say so.
7. STRUCTURE INSIDE A REACTION — put each drawn reactant/product inline as its own <smiles> where it sits and keep the \\ce arrow (with conditions) between them; the arrow STAYS \\ce, never inside <smiles>. Use the two-slot form \\(\\ce{->[above][below]}\\): <smiles>c1ccccc1</smiles> \\(\\ce{->[HNO3][H2SO4]}\\) <smiles>[O-][N+](=O)c1ccccc1</smiles>. A heat arrow is \\(\\ce{->[\\Delta]}\\); a printed-formula reagent stays \\ce alongside the drawn species.
8. AN OPTION THAT IS WHOLLY A STRUCTURE — the option body is JUST the tag "<smiles>Cc1ccccc1</smiles>": no surrounding \\(...\\), no \\ce, no label, no prose.

NEVER: a <smiles> wrapped in \\(...\\) or $...$; \\ce or any backslash-command inside <smiles>; an unclosed <smiles> tag; \\ce used to draw a ring/skeletal diagram; a benzene ring as C1CCCCC1; an unpaired ring-closure digit; a bare n for an N-H aromatic ring; a guessed SMILES for a wedge/dash-stereo, fused/bridged/spiro, or unreadable drawing (leave that one for image).

Examples (printed drawing -> emit): benzene ring -> <smiles>c1ccccc1</smiles> ; toluene -> <smiles>Cc1ccccc1</smiles> ; phenol -> <smiles>Oc1ccccc1</smiles> ; chlorobenzene -> <smiles>Clc1ccccc1</smiles> ; nitrobenzene -> <smiles>[O-][N+](=O)c1ccccc1</smiles> ; aniline -> <smiles>Nc1ccccc1</smiles> ; benzoic acid -> <smiles>OC(=O)c1ccccc1</smiles> ; styrene -> <smiles>C=Cc1ccccc1</smiles> ; o-xylene (1,2) -> <smiles>Cc1ccccc1C</smiles> ; m-xylene (1,3) -> <smiles>Cc1cccc(C)c1</smiles> ; p-xylene (1,4) -> <smiles>Cc1ccc(C)cc1</smiles> ; o-cresol -> <smiles>Cc1ccccc1O</smiles> ; p-nitrophenol -> <smiles>Oc1ccc([N+](=O)[O-])cc1</smiles> ; picric acid -> <smiles>Oc1c([N+](=O)[O-])cc([N+](=O)[O-])cc1[N+](=O)[O-]</smiles> ; naphthalene -> <smiles>c1ccc2ccccc2c1</smiles> ; anthracene -> <smiles>c1ccc2cc3ccccc3cc2c1</smiles> ; cyclohexane -> <smiles>C1CCCCC1</smiles> ; cyclopentane -> <smiles>C1CCCC1</smiles> ; pyridine -> <smiles>c1ccncc1</smiles> ; pyrrole -> <smiles>c1cc[nH]c1</smiles> ; furan -> <smiles>c1ccoc1</smiles> ; acetone (drawn) -> <smiles>CC(=O)C</smiles> ; propanal -> <smiles>CCC=O</smiles> ; acetic acid -> <smiles>CC(=O)O</smiles> ; ethyl benzoate -> <smiles>CCOC(=O)c1ccccc1</smiles> ; open-chain D-glucose (no stereo) -> <smiles>OCC(O)C(O)C(O)C(O)C=O</smiles> ; cis-2-butene -> <smiles>C/C=C\\C</smiles> ; benzene nitration (drawn -> drawn) -> <smiles>c1ccccc1</smiles> \\(\\ce{->[HNO3][H2SO4]}\\) <smiles>[O-][N+](=O)c1ccccc1</smiles> ; option is a drawn phenol -> <smiles>Oc1ccccc1</smiles> ; D-glucose drawn as a Fischer projection with wedge/dash stereo -> DO NOT emit SMILES; note it needs an image crop.`;

const DETECTION_DEFAULT = `You are an expert OCR and layout-analysis system for scanned examination papers.

The attached image is a question paper. Its pixel dimensions are {imgWidth} px wide × {imgHeight} px tall.

=============================
TASK: DETECT DIAGRAMS
=============================
1. Identify every question by its number (1, 2, 3 … or Q1, Q2 …).
2. For each question, detect if there is an associated GRAPHICAL ELEMENT (diagram, figure, graph, illustration, or shape).
   A single question may have SEVERAL graphical elements: one in its stem, and/or one inside EACH of its
   answer options when the options themselves are pictures. Report every element as its own entry in
   "detections" (repeating the same q_no).
3. Provide a TIGHT bounding box around only the visual/graphical pixels of that element. Trace the
   outermost ink of the diagram (including its labels only when they are part of the diagram), then add
   at most 4 pixels of padding. Do not include surrounding whitespace, question prose, answer text,
   option labels, page decorations, or another nearby diagram.
4. For every question that HAS a diagram, also copy the first line of that question's text verbatim
   (the words right after the question number, up to ~12 words) into "question_text". This is used to
   attach the cropped figure to the correct question, so transcribe it exactly as printed.
5. Separately, for EVERY numbered question on the page (whether or not it has a diagram), report its
   position: "y_top" = the vertical pixel (0 … {imgHeight}) of the TOP of that question's
   first line, and "x_left" = the horizontal pixel (0 … {imgWidth}) of the LEFT edge of the
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
  7. When the answer choices (A)/(B)/(C)/(D) or (1)/(2)/(3)/(4) are themselves pictures — graphs,
     circuits, shapes, vector diagrams — report EACH choice's picture as its own detection with
     target "option" and that choice's printed label in "option_label". Never return one box spanning
     several option pictures, and never skip option pictures just because the stem has no diagram.
     Option detections must also carry the question's first line in "question_text".

=============================
BOUNDING BOX FORMAT
=============================
[x, y, width, height]  — integers, pixel coords relative to the full image
  x      = left  edge  (0 … {imgWidth})
  y      = top   edge  (0 … {imgHeight})
  width  = box width   (x + width  ≤ {imgWidth})
  height = box height  (y + height ≤ {imgHeight})

=============================
OUTPUT FORMAT
=============================
Return a JSON object with two arrays — "questions" and "detections" — in this exact shape, no prose,
no markdown. "questions" lists every numbered question with its "y_top"; "detections" lists the
diagrams — a question with several graphical elements appears once per element. "question_text" may
be "" only for questions with no diagram:
{
  "questions": [
    {"q_no": 1, "x_left": 60, "y_top": 140},
    {"q_no": 2, "x_left": 60, "y_top": 512}
  ],
  "detections": [
    {"q_no": 1, "has_image": false, "bbox": null, "question_text": ""},
    {"q_no": 2, "has_image": true, "target": "question", "option_label": null, "bbox": [x, y, w, h], "question_text": "If |P| = 20, then P in cartesian form is"},
    {"q_no": 3, "has_image": true, "target": "option", "option_label": "A", "bbox": [x, y, w, h], "question_text": "Which graph best represents the motion"},
    {"q_no": 3, "has_image": true, "target": "option", "option_label": "B", "bbox": [x, y, w, h], "question_text": "Which graph best represents the motion"}
  ]
}`;

const ANSWER_KEY_DEFAULT = `You are given an image of an exam answer sheet ({context}).
Extract the answer key for EVERY section visible in the image into this exact JSON shape:

{
  "sections": [
    { "section_name": "Exercise O-1", "answers": { "1": "A", "2": "B", "3": "C" } }
  ]
}

ANSWER RULES:
1. Include ALL sections in the image; question numbers may restart per section.
2. answers keys are the question numbers as strings ("1", "2", …).
3. Format each answer value exactly as the ANSWER TYPE-SPECIFIC RULE below requires.
4. If no section name is printed, use "General".
5. Use LaTeX for math; return valid, complete JSON only — no prose, no trailing commas.`;

const SOLUTION_DEFAULT = `You are given an image from an exam SOLUTIONS booklet ({context}).
Extract the worked solution for EVERY question visible in the image into this exact JSON shape:

{
  "sections": [
    {
      "section_name": "Exercise O-1",
      "solutions": {
        "1": { "answer": "A", "explanation": "Step-by-step reasoning …" }
      }
    }
  ]
}

SOLUTION RULES:
1. Include ALL sections in the image; question numbers may restart per section.
2. solutions keys are the question numbers as strings ("1", "2", …).
3. explanation: the complete worked solution / reasoning as printed, preserving math as LaTeX (e.g. \\( \\sqrt{3} \\)). Do NOT summarise or omit steps.
4. answer: the final answer if the solution states one, formatted exactly as the ANSWER TYPE-SPECIFIC RULE below requires; use null if no final answer is given.
5. If no section name is printed, use "General".
6. Return valid, complete JSON only — no prose, double-quoted keys/strings, no trailing commas.`;

const LATEX_SYSTEM_DEFAULT =
  'You are a LaTeX formatting expert. You wrap math and physical quantities in a passage using ' +
  'inline LaTeX delimiters \\(...\\). You never change, add, or remove any words — you only add ' +
  'delimiters and normalise math notation.';

const LATEX_USER_DEFAULT = `Wrap every mathematical expression and physical quantity in the text below using ONLY inline delimiters \\(...\\).

RULES
1. Wrap math: fractions, roots, powers/subscripts, Greek letters, equations, comparisons, symbols.
2. A physical quantity (a number followed by a unit, e.g. "m/sec", "kg", "m/s^2", "N", "°C") is math. Wrap the WHOLE thing — number AND unit — in one \\(...\\) group, and put the unit inside \\text{...}. Example: -3 m/sec  ->  \\(-3\\ \\text{m/sec}\\)
3. Units ALWAYS go inside \\text{...}, and every \\text{...} MUST sit inside \\(...\\). Never output a bare \\text{...} outside \\(...\\).
4. If the text already contains delimiters ($...$, \\[...\\], [...]) or a bare \\text{...}, convert them to correct \\(...\\) form.
5. Do NOT add, remove, reword, explain, or translate any text. Only wrap. Plain prose stays exactly as written, only its math/quantities get wrapped.
6. Preserve all spacing and punctuation outside the wrapped math.
7. If a value already sits inside correct \\(...\\), leave it; just fix the unit to \\text{...} if needed.
8. Chemistry: wrap any chemical formula, ion, or reaction with mhchem \\ce{...} inside \\(...\\) — e.g. \\(\\ce{H2O}\\), \\(\\ce{SO4^2-}\\), \\(\\ce{2H2 + O2 -> 2H2O}\\) (never H₂O, H_2O, or \\text{H}_2\\text{O}). \\ce holds ONLY chemical species / equations — never ordinary words, and never a physical quantity with a unit (a unit stays rule 2).
9. Keep \\ce out of quantities and names: a concentration keeps its brackets OUTSIDE \\ce (\\([\\ce{H+}]\\)); a printed chemical NAME (sodium chloride, glucose) stays prose — never turn it into a formula. Do NOT invent \\ce syntax beyond these examples.

EXAMPLES
Input:  "6 \\text{ m/sec}"          Output: "\\(6\\ \\text{m/sec}\\)"
Input:  "-3 m/sec"                  Output: "\\(-3\\ \\text{m/sec}\\)"
Input:  "5 kg"                      Output: "\\(5\\ \\text{kg}\\)"
Input:  "x^2 + 5x - 6 = 0"          Output: "\\(x^2 + 5x - 6 = 0\\)"
Input:  "v = 20 m/s"                Output: "\\(v = 20\\ \\text{m/s}\\)"
Input:  "The ball moves at 9.8 m/s^2 downward"   Output: "The ball moves at \\(9.8\\ \\text{m/s}^2\\) downward"
Input:  "H2O"                       Output: "\\(\\ce{H2O}\\)"
Input:  "H_2O"                      Output: "\\(\\ce{H2O}\\)"
Input:  "the SO4^2- ion"            Output: "the \\(\\ce{SO4^2-}\\) ion"
Input:  "2H2 + O2 -> 2H2O"          Output: "\\(\\ce{2H2 + O2 -> 2H2O}\\)"
Input:  "concentration [H+]"        Output: "concentration \\([\\ce{H+}]\\)"

Input text: "{text}"

Return valid JSON only: { "refined_text": "..." }`;

/** Default text for every editable prompt — what the builders fall back to and what "Reset" restores. */
export const PROMPT_DEFAULTS: Record<PromptKey, string> = {
  extraction: EXTRACTION_DEFAULT,
  inlineAnswer: INLINE_ANSWER_DEFAULT,
  pyq: PYQ_DEFAULT,
  chemistry: CHEMISTRY_DEFAULT,
  smiles: SMILES_DEFAULT,
  detection: DETECTION_DEFAULT,
  answerKey: ANSWER_KEY_DEFAULT,
  solution: SOLUTION_DEFAULT,
  latexSystem: LATEX_SYSTEM_DEFAULT,
  latexUser: LATEX_USER_DEFAULT,
};

/** Operator-facing metadata + the `{tokens}` each prompt must keep, in display order. */
export const PROMPT_META: Record<PromptKey, { label: string; description: string; tokens: string[] }> = {
  extraction: {
    label: 'Question extraction',
    description: 'Core rules for reading questions off a page. The per-type rule, PYQ, and inline-answer blocks are appended automatically.',
    tokens: [],
  },
  inlineAnswer: {
    label: 'Inline answer key',
    description: 'Appended when a paper prints each answer next to its question, so extraction reads the answer + solution in the same pass.',
    tokens: [],
  },
  pyq: {
    label: 'PYQ source/year',
    description: 'Appended for a previous-year-questions segment, asking the model to read each question’s source exam + year off the page.',
    tokens: [],
  },
  chemistry: {
    label: 'Chemistry (mhchem)',
    description: 'Appended to question + solution extraction so chemical formulae, ions, and reactions are written with mhchem \\ce{…} inside \\( … \\) — the form that renders in the app and the published bank.',
    tokens: [],
  },
  smiles: {
    label: 'Drawn structures (SMILES)',
    description: 'Appended after the chemistry rule so a molecule DRAWN as a 2-D diagram (benzene rings, skeletal/organic structures) is emitted as <smiles>…</smiles> and rendered as a real structure — instead of garbled text or a plain formula.',
    tokens: [],
  },
  detection: {
    label: 'Figure detection (scan / crop)',
    description: 'Drives every figure scan — single page, all pages, and auto-crop. Must keep the image-size tokens.',
    tokens: ['imgWidth', 'imgHeight'],
  },
  answerKey: {
    label: 'Answer-sheet extraction',
    description: 'Reads a separate answer sheet into a section → number → answer map. A per-type answer-format rule is appended.',
    tokens: ['context'],
  },
  solution: {
    label: 'Solution extraction',
    description: 'Reads a solutions booklet into a section → number → { answer, explanation } map. A per-type answer-format rule is appended.',
    tokens: ['context'],
  },
  latexSystem: {
    label: 'LaTeX fixer (system)',
    description: 'System role for the per-field “Fix LaTeX with AI” refiner.',
    tokens: [],
  },
  latexUser: {
    label: 'LaTeX fixer (instructions)',
    description: 'Instructions for wrapping math/units in \\(...\\). Must keep the {text} token where the field’s content is inserted.',
    tokens: ['text'],
  },
};

/** Substitute `{token}` placeholders; an unknown token is left intact so a typo is visible, not silent. */
export function fillTokens(template: string, tokens: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in tokens ? String(tokens[key]) : whole,
  );
}

/** The effective text for a prompt: the operator's override when present, else the code default. */
export function resolvePrompt(overrides: PromptOverrides, key: PromptKey): string {
  return overrides[key] ?? PROMPT_DEFAULTS[key];
}
