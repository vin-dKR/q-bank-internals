/**
 * The searchable catalogue behind the equation editor. Each entry inserts a LaTeX snippet into the
 * builder; `preview` is what the picker button renders (a filled-in sample, so a template like a
 * fraction shows `a/b` rather than empty boxes), while `insert` is what actually goes into the text —
 * a `‸` in it marks where the caret should land after insertion (usually the first empty argument).
 *
 * Kept deliberately as plain data (not a library like mathlive) so the picker stays light and every
 * inserted string is ordinary `\(...\)`-ready LaTeX the rest of the app already renders with KaTeX.
 */
export type MathSymbol = {
  /** Human name, shown under the preview and matched by search. */
  name: string;
  /** Extra search terms (synonyms) so e.g. "integration" finds the integral. */
  keywords: string[];
  category: MathCategory;
  /** LaTeX rendered on the picker button (a filled sample for templates). */
  preview: string;
  /** LaTeX inserted into the builder; `‸` marks the post-insert caret position. */
  insert: string;
};

export type MathCategory =
  | 'Common'
  | 'Greek'
  | 'Operators'
  | 'Relations'
  | 'Calculus'
  | 'Arrows'
  | 'Sets & logic'
  | 'Functions'
  | 'Structures'
  | 'Accents';

/** Marks the caret landing spot inside an inserted snippet (stripped before insertion). */
export const CARET = '‸';

export const MATH_CATEGORIES: MathCategory[] = [
  'Common',
  'Greek',
  'Operators',
  'Relations',
  'Calculus',
  'Arrows',
  'Sets & logic',
  'Functions',
  'Structures',
  'Accents',
];

export const MATH_SYMBOLS: MathSymbol[] = [
  // --- Common ---
  { name: 'Fraction', keywords: ['divide', 'over', 'ratio'], category: 'Common', preview: '\\frac{a}{b}', insert: '\\frac{‸}{}' },
  { name: 'Square root', keywords: ['radical', 'surd'], category: 'Common', preview: '\\sqrt{x}', insert: '\\sqrt{‸}' },
  { name: 'nth root', keywords: ['radical', 'cube root'], category: 'Common', preview: '\\sqrt[n]{x}', insert: '\\sqrt[‸]{}' },
  { name: 'Superscript', keywords: ['power', 'exponent', 'squared'], category: 'Common', preview: 'x^{2}', insert: '^{‸}' },
  { name: 'Subscript', keywords: ['index', 'suffix'], category: 'Common', preview: 'x_{i}', insert: '_{‸}' },
  { name: 'Sub & superscript', keywords: ['index power'], category: 'Common', preview: 'x_{i}^{2}', insert: '_{‸}^{}' },
  { name: 'Times', keywords: ['multiply', 'cross', 'product'], category: 'Common', preview: '\\times', insert: '\\times ' },
  { name: 'Dot product', keywords: ['multiply', 'cdot'], category: 'Common', preview: '\\cdot', insert: '\\cdot ' },
  { name: 'Divide', keywords: ['division', 'obelus'], category: 'Common', preview: '\\div', insert: '\\div ' },
  { name: 'Plus–minus', keywords: ['pm', 'uncertainty'], category: 'Common', preview: '\\pm', insert: '\\pm ' },
  { name: 'Minus–plus', keywords: ['mp'], category: 'Common', preview: '\\mp', insert: '\\mp ' },
  { name: 'Degree', keywords: ['angle', 'temperature'], category: 'Common', preview: '90^{\\circ}', insert: '^{\\circ}' },
  { name: 'Infinity', keywords: ['infinite'], category: 'Common', preview: '\\infty', insert: '\\infty ' },
  { name: 'Percent', keywords: ['percentage'], category: 'Common', preview: '\\%', insert: '\\%' },

  // --- Greek ---
  { name: 'alpha', keywords: ['greek'], category: 'Greek', preview: '\\alpha', insert: '\\alpha ' },
  { name: 'beta', keywords: ['greek'], category: 'Greek', preview: '\\beta', insert: '\\beta ' },
  { name: 'gamma', keywords: ['greek'], category: 'Greek', preview: '\\gamma', insert: '\\gamma ' },
  { name: 'delta', keywords: ['greek'], category: 'Greek', preview: '\\delta', insert: '\\delta ' },
  { name: 'epsilon', keywords: ['greek'], category: 'Greek', preview: '\\epsilon', insert: '\\epsilon ' },
  { name: 'theta', keywords: ['greek', 'angle'], category: 'Greek', preview: '\\theta', insert: '\\theta ' },
  { name: 'lambda', keywords: ['greek', 'wavelength'], category: 'Greek', preview: '\\lambda', insert: '\\lambda ' },
  { name: 'mu', keywords: ['greek', 'micro', 'mean'], category: 'Greek', preview: '\\mu', insert: '\\mu ' },
  { name: 'pi', keywords: ['greek', 'circle'], category: 'Greek', preview: '\\pi', insert: '\\pi ' },
  { name: 'rho', keywords: ['greek', 'density'], category: 'Greek', preview: '\\rho', insert: '\\rho ' },
  { name: 'sigma', keywords: ['greek'], category: 'Greek', preview: '\\sigma', insert: '\\sigma ' },
  { name: 'phi', keywords: ['greek'], category: 'Greek', preview: '\\phi', insert: '\\phi ' },
  { name: 'omega', keywords: ['greek', 'angular'], category: 'Greek', preview: '\\omega', insert: '\\omega ' },
  { name: 'Delta (Δ)', keywords: ['greek', 'change', 'capital'], category: 'Greek', preview: '\\Delta', insert: '\\Delta ' },
  { name: 'Sigma (Σ)', keywords: ['greek', 'capital'], category: 'Greek', preview: '\\Sigma', insert: '\\Sigma ' },
  { name: 'Omega (Ω)', keywords: ['greek', 'ohm', 'capital'], category: 'Greek', preview: '\\Omega', insert: '\\Omega ' },
  { name: 'Pi (Π)', keywords: ['greek', 'capital'], category: 'Greek', preview: '\\Pi', insert: '\\Pi ' },
  { name: 'Phi (Φ)', keywords: ['greek', 'flux', 'capital'], category: 'Greek', preview: '\\Phi', insert: '\\Phi ' },
  { name: 'theta (θ) hat', keywords: ['unit vector'], category: 'Greek', preview: '\\hat{\\theta}', insert: '\\hat{\\theta}' },

  // --- Operators ---
  { name: 'Summation', keywords: ['sum', 'sigma', 'series'], category: 'Operators', preview: '\\sum_{i=1}^{n}', insert: '\\sum_{‸}^{}' },
  { name: 'Product', keywords: ['prod', 'multiply series'], category: 'Operators', preview: '\\prod_{i=1}^{n}', insert: '\\prod_{‸}^{}' },
  { name: 'Union (⋃)', keywords: ['bigcup'], category: 'Operators', preview: '\\bigcup', insert: '\\bigcup ' },
  { name: 'Intersection (⋂)', keywords: ['bigcap'], category: 'Operators', preview: '\\bigcap', insert: '\\bigcap ' },

  // --- Relations ---
  { name: 'Less than or equal', keywords: ['leq', 'le'], category: 'Relations', preview: '\\leq', insert: '\\leq ' },
  { name: 'Greater than or equal', keywords: ['geq', 'ge'], category: 'Relations', preview: '\\geq', insert: '\\geq ' },
  { name: 'Not equal', keywords: ['neq', 'ne'], category: 'Relations', preview: '\\neq', insert: '\\neq ' },
  { name: 'Approximately', keywords: ['approx', 'about'], category: 'Relations', preview: '\\approx', insert: '\\approx ' },
  { name: 'Equivalent', keywords: ['equiv', 'identical'], category: 'Relations', preview: '\\equiv', insert: '\\equiv ' },
  { name: 'Proportional to', keywords: ['propto'], category: 'Relations', preview: '\\propto', insert: '\\propto ' },
  { name: 'Similar', keywords: ['sim', 'tilde'], category: 'Relations', preview: '\\sim', insert: '\\sim ' },
  { name: 'Much less than', keywords: ['ll'], category: 'Relations', preview: '\\ll', insert: '\\ll ' },
  { name: 'Much greater than', keywords: ['gg'], category: 'Relations', preview: '\\gg', insert: '\\gg ' },

  // --- Calculus ---
  { name: 'Integral', keywords: ['integration', 'integrate', 'antiderivative'], category: 'Calculus', preview: '\\int', insert: '\\int ‸\\, dx' },
  { name: 'Definite integral', keywords: ['integration', 'bounds', 'area under curve'], category: 'Calculus', preview: '\\int_{a}^{b}', insert: '\\int_{‸}^{}' },
  { name: 'Double integral', keywords: ['integration', 'surface'], category: 'Calculus', preview: '\\iint', insert: '\\iint ‸' },
  { name: 'Contour integral', keywords: ['integration', 'loop', 'oint'], category: 'Calculus', preview: '\\oint', insert: '\\oint ‸' },
  { name: 'Limit', keywords: ['lim', 'tends to'], category: 'Calculus', preview: '\\lim_{x \\to 0}', insert: '\\lim_{‸ \\to }' },
  { name: 'Derivative', keywords: ['differentiate', 'd/dx'], category: 'Calculus', preview: '\\frac{d}{dx}', insert: '\\frac{d}{d‸}' },
  { name: 'Partial derivative', keywords: ['partial', 'differentiate'], category: 'Calculus', preview: '\\frac{\\partial f}{\\partial x}', insert: '\\frac{\\partial ‸}{\\partial }' },
  { name: 'Partial (∂)', keywords: ['partial'], category: 'Calculus', preview: '\\partial', insert: '\\partial ' },
  { name: 'Nabla / grad', keywords: ['del', 'gradient', 'divergence'], category: 'Calculus', preview: '\\nabla', insert: '\\nabla ' },
  { name: 'Prime', keywords: ['derivative', 'dash'], category: 'Calculus', preview: "f'(x)", insert: "'" },

  // --- Arrows ---
  { name: 'Right arrow', keywords: ['to', 'rightarrow', 'yields'], category: 'Arrows', preview: '\\rightarrow', insert: '\\rightarrow ' },
  { name: 'Left arrow', keywords: ['leftarrow'], category: 'Arrows', preview: '\\leftarrow', insert: '\\leftarrow ' },
  { name: 'Implies (⇒)', keywords: ['implies', 'rightarrow double'], category: 'Arrows', preview: '\\Rightarrow', insert: '\\Rightarrow ' },
  { name: 'Iff (⇔)', keywords: ['if and only if', 'equivalence'], category: 'Arrows', preview: '\\Leftrightarrow', insert: '\\Leftrightarrow ' },
  { name: 'Maps to', keywords: ['mapsto'], category: 'Arrows', preview: '\\mapsto', insert: '\\mapsto ' },
  { name: 'Equilibrium', keywords: ['reversible', 'chemistry', 'harpoons'], category: 'Arrows', preview: '\\rightleftharpoons', insert: '\\rightleftharpoons ' },

  // --- Sets & logic ---
  { name: 'Element of', keywords: ['in', 'belongs'], category: 'Sets & logic', preview: '\\in', insert: '\\in ' },
  { name: 'Not an element', keywords: ['notin'], category: 'Sets & logic', preview: '\\notin', insert: '\\notin ' },
  { name: 'Subset', keywords: ['subset'], category: 'Sets & logic', preview: '\\subset', insert: '\\subset ' },
  { name: 'Subset or equal', keywords: ['subseteq'], category: 'Sets & logic', preview: '\\subseteq', insert: '\\subseteq ' },
  { name: 'Union', keywords: ['cup', 'or'], category: 'Sets & logic', preview: '\\cup', insert: '\\cup ' },
  { name: 'Intersection', keywords: ['cap', 'and'], category: 'Sets & logic', preview: '\\cap', insert: '\\cap ' },
  { name: 'Empty set', keywords: ['null', 'emptyset'], category: 'Sets & logic', preview: '\\emptyset', insert: '\\emptyset ' },
  { name: 'For all', keywords: ['forall', 'universal'], category: 'Sets & logic', preview: '\\forall', insert: '\\forall ' },
  { name: 'There exists', keywords: ['exists', 'existential'], category: 'Sets & logic', preview: '\\exists', insert: '\\exists ' },
  { name: 'Therefore', keywords: ['therefore'], category: 'Sets & logic', preview: '\\therefore', insert: '\\therefore ' },
  { name: 'Because', keywords: ['because'], category: 'Sets & logic', preview: '\\because', insert: '\\because ' },
  { name: 'Real numbers', keywords: ['blackboard', 'R'], category: 'Sets & logic', preview: '\\mathbb{R}', insert: '\\mathbb{R}' },
  { name: 'Integers', keywords: ['blackboard', 'Z'], category: 'Sets & logic', preview: '\\mathbb{Z}', insert: '\\mathbb{Z}' },
  { name: 'Naturals', keywords: ['blackboard', 'N'], category: 'Sets & logic', preview: '\\mathbb{N}', insert: '\\mathbb{N}' },

  // --- Functions ---
  { name: 'sin', keywords: ['trig', 'sine'], category: 'Functions', preview: '\\sin', insert: '\\sin ' },
  { name: 'cos', keywords: ['trig', 'cosine'], category: 'Functions', preview: '\\cos', insert: '\\cos ' },
  { name: 'tan', keywords: ['trig', 'tangent'], category: 'Functions', preview: '\\tan', insert: '\\tan ' },
  { name: 'log', keywords: ['logarithm'], category: 'Functions', preview: '\\log', insert: '\\log ' },
  { name: 'ln', keywords: ['natural log'], category: 'Functions', preview: '\\ln', insert: '\\ln ' },
  { name: 'exp', keywords: ['exponential'], category: 'Functions', preview: '\\exp', insert: '\\exp ' },
  { name: 'log base', keywords: ['logarithm subscript'], category: 'Functions', preview: '\\log_{2}', insert: '\\log_{‸}' },

  // --- Structures ---
  { name: '2×2 matrix', keywords: ['matrix', 'array'], category: 'Structures', preview: '\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}', insert: '\\begin{pmatrix} ‸ & \\\\ & \\end{pmatrix}' },
  { name: 'Determinant', keywords: ['matrix', 'vmatrix'], category: 'Structures', preview: '\\begin{vmatrix}a&b\\\\c&d\\end{vmatrix}', insert: '\\begin{vmatrix} ‸ & \\\\ & \\end{vmatrix}' },
  { name: 'Cases', keywords: ['piecewise', 'branches'], category: 'Structures', preview: 'f(x)=\\begin{cases}a\\\\b\\end{cases}', insert: '\\begin{cases} ‸ & \\\\ & \\end{cases}' },
  { name: 'Binomial', keywords: ['choose', 'nCr', 'combination'], category: 'Structures', preview: '\\binom{n}{k}', insert: '\\binom{‸}{}' },
  { name: 'Parentheses (auto)', keywords: ['brackets', 'left right'], category: 'Structures', preview: '\\left( x \\right)', insert: '\\left( ‸ \\right)' },
  { name: 'Overbrace', keywords: ['annotate'], category: 'Structures', preview: '\\overbrace{a+b}', insert: '\\overbrace{‸}' },

  // --- Accents ---
  { name: 'Vector', keywords: ['arrow', 'vec'], category: 'Accents', preview: '\\vec{v}', insert: '\\vec{‸}' },
  { name: 'Hat', keywords: ['unit', 'estimate'], category: 'Accents', preview: '\\hat{x}', insert: '\\hat{‸}' },
  { name: 'Bar / mean', keywords: ['average', 'overline'], category: 'Accents', preview: '\\bar{x}', insert: '\\bar{‸}' },
  { name: 'Dot (rate)', keywords: ['derivative', 'time'], category: 'Accents', preview: '\\dot{x}', insert: '\\dot{‸}' },
  { name: 'Double dot', keywords: ['acceleration', 'ddot'], category: 'Accents', preview: '\\ddot{x}', insert: '\\ddot{‸}' },
  { name: 'Overline', keywords: ['bar', 'conjugate'], category: 'Accents', preview: '\\overline{AB}', insert: '\\overline{‸}' },
  { name: 'Tilde', keywords: ['approx', 'widetilde'], category: 'Accents', preview: '\\tilde{x}', insert: '\\tilde{‸}' },
];

/** Filter the catalogue by a free-text query against name + keywords (case-insensitive, all-terms). */
export function filterMathSymbols(query: string): MathSymbol[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return MATH_SYMBOLS;
  return MATH_SYMBOLS.filter((symbol) => {
    const haystack = `${symbol.name} ${symbol.keywords.join(' ')} ${symbol.category}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}
