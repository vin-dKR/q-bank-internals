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
  | 'Chemistry'
  | 'Geometry'
  | 'Sets & logic'
  | 'Functions'
  | 'Structures'
  | 'Brackets'
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
  'Chemistry',
  'Geometry',
  'Sets & logic',
  'Functions',
  'Structures',
  'Brackets',
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
  { name: 'Text (words in math)', keywords: ['text', 'words', 'roman', 'upright', 'label'], category: 'Common', preview: '\\text{if } x>0', insert: '\\text{‸}' },
  { name: 'Upright / roman', keywords: ['mathrm', 'unit', 'upright'], category: 'Common', preview: '\\mathrm{d}x', insert: '\\mathrm{‸}' },
  { name: 'Bullet', keywords: ['dot', 'point'], category: 'Common', preview: '\\bullet', insert: '\\bullet ' },
  { name: 'Asterisk', keywords: ['star', 'ast', 'convolution'], category: 'Common', preview: '\\ast', insert: '\\ast ' },
  { name: 'Star', keywords: ['operation'], category: 'Common', preview: '\\star', insert: '\\star ' },
  { name: 'Prime', keywords: ['dash', 'minute', 'feet'], category: 'Common', preview: "x'", insert: "'" },
  { name: 'Horizontal dots', keywords: ['ellipsis', 'cdots', 'ldots'], category: 'Common', preview: '\\cdots', insert: '\\cdots ' },
  { name: 'Baseline dots', keywords: ['ellipsis', 'ldots'], category: 'Common', preview: '\\ldots', insert: '\\ldots ' },
  { name: 'Angle (°) template', keywords: ['degree', 'temperature'], category: 'Common', preview: '25\\,^{\\circ}\\text{C}', insert: '^{\\circ}\\text{‸}' },

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
  { name: 'zeta', keywords: ['greek'], category: 'Greek', preview: '\\zeta', insert: '\\zeta ' },
  { name: 'eta', keywords: ['greek', 'efficiency', 'viscosity'], category: 'Greek', preview: '\\eta', insert: '\\eta ' },
  { name: 'iota', keywords: ['greek'], category: 'Greek', preview: '\\iota', insert: '\\iota ' },
  { name: 'kappa', keywords: ['greek', 'constant'], category: 'Greek', preview: '\\kappa', insert: '\\kappa ' },
  { name: 'nu', keywords: ['greek', 'frequency'], category: 'Greek', preview: '\\nu', insert: '\\nu ' },
  { name: 'xi', keywords: ['greek'], category: 'Greek', preview: '\\xi', insert: '\\xi ' },
  { name: 'tau', keywords: ['greek', 'torque', 'time constant'], category: 'Greek', preview: '\\tau', insert: '\\tau ' },
  { name: 'upsilon', keywords: ['greek'], category: 'Greek', preview: '\\upsilon', insert: '\\upsilon ' },
  { name: 'chi', keywords: ['greek', 'chi squared'], category: 'Greek', preview: '\\chi', insert: '\\chi ' },
  { name: 'psi', keywords: ['greek', 'wavefunction'], category: 'Greek', preview: '\\psi', insert: '\\psi ' },
  { name: 'var-epsilon', keywords: ['greek', 'epsilon', 'permittivity'], category: 'Greek', preview: '\\varepsilon', insert: '\\varepsilon ' },
  { name: 'var-phi', keywords: ['greek', 'phi', 'potential'], category: 'Greek', preview: '\\varphi', insert: '\\varphi ' },
  { name: 'var-theta', keywords: ['greek', 'theta'], category: 'Greek', preview: '\\vartheta', insert: '\\vartheta ' },
  { name: 'Gamma (Γ)', keywords: ['greek', 'capital'], category: 'Greek', preview: '\\Gamma', insert: '\\Gamma ' },
  { name: 'Theta (Θ)', keywords: ['greek', 'capital'], category: 'Greek', preview: '\\Theta', insert: '\\Theta ' },
  { name: 'Lambda (Λ)', keywords: ['greek', 'capital'], category: 'Greek', preview: '\\Lambda', insert: '\\Lambda ' },
  { name: 'Xi (Ξ)', keywords: ['greek', 'capital'], category: 'Greek', preview: '\\Xi', insert: '\\Xi ' },
  { name: 'Psi (Ψ)', keywords: ['greek', 'capital', 'wavefunction'], category: 'Greek', preview: '\\Psi', insert: '\\Psi ' },
  { name: 'Upsilon (ϒ)', keywords: ['greek', 'capital'], category: 'Greek', preview: '\\Upsilon', insert: '\\Upsilon ' },

  // --- Operators ---
  { name: 'Summation', keywords: ['sum', 'sigma', 'series'], category: 'Operators', preview: '\\sum_{i=1}^{n}', insert: '\\sum_{‸}^{}' },
  { name: 'Product', keywords: ['prod', 'multiply series'], category: 'Operators', preview: '\\prod_{i=1}^{n}', insert: '\\prod_{‸}^{}' },
  { name: 'Union (⋃)', keywords: ['bigcup'], category: 'Operators', preview: '\\bigcup', insert: '\\bigcup ' },
  { name: 'Intersection (⋂)', keywords: ['bigcap'], category: 'Operators', preview: '\\bigcap', insert: '\\bigcap ' },
  { name: 'Plus in circle', keywords: ['oplus', 'direct sum', 'xor'], category: 'Operators', preview: '\\oplus', insert: '\\oplus ' },
  { name: 'Times in circle', keywords: ['otimes', 'tensor', 'cross'], category: 'Operators', preview: '\\otimes', insert: '\\otimes ' },
  { name: 'Dot in circle', keywords: ['odot'], category: 'Operators', preview: '\\odot', insert: '\\odot ' },
  { name: 'Minus in circle', keywords: ['ominus'], category: 'Operators', preview: '\\ominus', insert: '\\ominus ' },
  { name: 'Logical and (∧)', keywords: ['wedge', 'and', 'meet'], category: 'Operators', preview: '\\wedge', insert: '\\wedge ' },
  { name: 'Logical or (∨)', keywords: ['vee', 'or', 'join'], category: 'Operators', preview: '\\vee', insert: '\\vee ' },
  { name: 'Set minus', keywords: ['difference', 'backslash', 'without'], category: 'Operators', preview: '\\setminus', insert: '\\setminus ' },
  { name: 'Asterisk operator', keywords: ['star', 'convolution'], category: 'Operators', preview: '\\ast', insert: '\\ast ' },
  { name: 'Circle operator', keywords: ['compose', 'ring'], category: 'Operators', preview: '\\circ', insert: '\\circ ' },
  { name: 'Square root of unity', keywords: ['sqrt operator'], category: 'Operators', preview: '\\surd', insert: '\\surd ' },

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
  { name: 'Congruent', keywords: ['cong', 'congruent', 'geometry'], category: 'Relations', preview: '\\cong', insert: '\\cong ' },
  { name: 'Asymptotically equal', keywords: ['simeq'], category: 'Relations', preview: '\\simeq', insert: '\\simeq ' },
  { name: 'Approximately equal', keywords: ['approxeq'], category: 'Relations', preview: '\\approxeq', insert: '\\approxeq ' },
  { name: 'Defined as', keywords: ['doteq', 'definition'], category: 'Relations', preview: '\\doteq', insert: '\\doteq ' },
  { name: 'Not less than or equal', keywords: ['nleq'], category: 'Relations', preview: '\\nleq', insert: '\\nleq ' },
  { name: 'Not greater than or equal', keywords: ['ngeq'], category: 'Relations', preview: '\\ngeq', insert: '\\ngeq ' },
  { name: 'Precedes', keywords: ['prec', 'order'], category: 'Relations', preview: '\\prec', insert: '\\prec ' },
  { name: 'Succeeds', keywords: ['succ', 'order'], category: 'Relations', preview: '\\succ', insert: '\\succ ' },
  { name: 'Parallel', keywords: ['parallel', 'lines', 'geometry'], category: 'Relations', preview: '\\parallel', insert: '\\parallel ' },
  { name: 'Not parallel', keywords: ['nparallel'], category: 'Relations', preview: '\\nparallel', insert: '\\nparallel ' },
  { name: 'Perpendicular', keywords: ['perp', 'right angle', 'geometry'], category: 'Relations', preview: '\\perp', insert: '\\perp ' },
  { name: 'Divides', keywords: ['mid', 'divisibility'], category: 'Relations', preview: 'a \\mid b', insert: '\\mid ' },
  { name: 'Does not divide', keywords: ['nmid'], category: 'Relations', preview: '\\nmid', insert: '\\nmid ' },

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
  { name: 'Long right arrow', keywords: ['longrightarrow', 'yields'], category: 'Arrows', preview: '\\longrightarrow', insert: '\\longrightarrow ' },
  { name: 'Long left arrow', keywords: ['longleftarrow'], category: 'Arrows', preview: '\\longleftarrow', insert: '\\longleftarrow ' },
  { name: 'Left–right arrow', keywords: ['leftrightarrow', 'both'], category: 'Arrows', preview: '\\leftrightarrow', insert: '\\leftrightarrow ' },
  { name: 'Up arrow', keywords: ['uparrow', 'gas', 'increase'], category: 'Arrows', preview: '\\uparrow', insert: '\\uparrow ' },
  { name: 'Down arrow', keywords: ['downarrow', 'precipitate', 'decrease'], category: 'Arrows', preview: '\\downarrow', insert: '\\downarrow ' },
  { name: 'Up–down arrow', keywords: ['updownarrow'], category: 'Arrows', preview: '\\updownarrow', insert: '\\updownarrow ' },
  { name: 'Long implies (⟹)', keywords: ['implies', 'longrightarrow double'], category: 'Arrows', preview: '\\implies', insert: '\\implies ' },
  { name: 'Long iff (⟺)', keywords: ['iff', 'equivalence'], category: 'Arrows', preview: '\\iff', insert: '\\iff ' },
  { name: 'Hooked arrow', keywords: ['hookrightarrow', 'injection'], category: 'Arrows', preview: '\\hookrightarrow', insert: '\\hookrightarrow ' },
  { name: 'Diagonal up (↗)', keywords: ['nearrow'], category: 'Arrows', preview: '\\nearrow', insert: '\\nearrow ' },
  { name: 'Diagonal down (↘)', keywords: ['searrow'], category: 'Arrows', preview: '\\searrow', insert: '\\searrow ' },
  { name: 'Arrow with label', keywords: ['xrightarrow', 'over', 'condition'], category: 'Arrows', preview: '\\xrightarrow{f}', insert: '\\xrightarrow{‸}' },

  // --- Chemistry ---
  // All plain KaTeX (no mhchem \\ce needed), so every snippet renders identically in the bank too.
  { name: 'Reaction arrow (→)', keywords: ['yields', 'produces', 'gives', 'chemistry'], category: 'Chemistry', preview: '\\longrightarrow', insert: '\\longrightarrow ' },
  { name: 'Reaction w/ condition', keywords: ['heat', 'catalyst', 'over arrow', 'delta', 'chemistry'], category: 'Chemistry', preview: '\\xrightarrow{\\Delta}', insert: '\\xrightarrow{‸}' },
  { name: 'Reaction w/ condition & catalyst', keywords: ['heat', 'catalyst', 'above below', 'chemistry'], category: 'Chemistry', preview: '\\xrightarrow[\\text{cat.}]{\\Delta}', insert: '\\xrightarrow[‸]{}' },
  { name: 'Reversible ⇌', keywords: ['equilibrium', 'reversible', 'harpoons', 'chemistry'], category: 'Chemistry', preview: '\\rightleftharpoons', insert: '\\rightleftharpoons ' },
  { name: 'Reversible w/ conditions', keywords: ['equilibrium', 'conditions', 'chemistry'], category: 'Chemistry', preview: '\\xrightleftharpoons[T]{P}', insert: '\\xrightleftharpoons[‸]{}' },
  { name: 'Gas evolved (↑)', keywords: ['gas', 'up arrow', 'evolves', 'chemistry'], category: 'Chemistry', preview: '\\text{H}_2\\uparrow', insert: '\\uparrow ' },
  { name: 'Precipitate (↓)', keywords: ['precipitate', 'down arrow', 'settles', 'chemistry'], category: 'Chemistry', preview: '\\text{AgCl}\\downarrow', insert: '\\downarrow ' },
  { name: 'Positive charge', keywords: ['cation', 'ion', 'plus', 'chemistry'], category: 'Chemistry', preview: '\\text{Na}^{+}', insert: '^{+}' },
  { name: 'Negative charge', keywords: ['anion', 'ion', 'minus', 'chemistry'], category: 'Chemistry', preview: '\\text{Cl}^{-}', insert: '^{-}' },
  { name: 'Charge 2+', keywords: ['cation', 'ion', 'chemistry'], category: 'Chemistry', preview: '\\text{Ca}^{2+}', insert: '^{2+}' },
  { name: 'Charge 2−', keywords: ['anion', 'ion', 'chemistry'], category: 'Chemistry', preview: '\\text{SO}_4^{2-}', insert: '^{2-}' },
  { name: 'Subscript count', keywords: ['formula', 'number of atoms', 'chemistry'], category: 'Chemistry', preview: '\\text{H}_{2}\\text{O}', insert: '_{‸}' },
  { name: 'State — aqueous', keywords: ['aq', 'solution', 'state', 'chemistry'], category: 'Chemistry', preview: '\\text{(aq)}', insert: '\\text{(aq)}' },
  { name: 'State — solid', keywords: ['s', 'state', 'chemistry'], category: 'Chemistry', preview: '\\text{(s)}', insert: '\\text{(s)}' },
  { name: 'State — liquid', keywords: ['l', 'state', 'chemistry'], category: 'Chemistry', preview: '\\text{(l)}', insert: '\\text{(l)}' },
  { name: 'State — gas', keywords: ['g', 'state', 'chemistry'], category: 'Chemistry', preview: '\\text{(g)}', insert: '\\text{(g)}' },
  { name: 'Partial charge δ+', keywords: ['delta', 'dipole', 'polarity', 'chemistry'], category: 'Chemistry', preview: '\\delta^{+}', insert: '\\delta^{+}' },
  { name: 'Partial charge δ−', keywords: ['delta', 'dipole', 'polarity', 'chemistry'], category: 'Chemistry', preview: '\\delta^{-}', insert: '\\delta^{-}' },
  { name: 'Single bond', keywords: ['bond', 'chemistry'], category: 'Chemistry', preview: '\\text{H}-\\text{H}', insert: '-' },
  { name: 'Double bond', keywords: ['bond', 'chemistry'], category: 'Chemistry', preview: '\\text{O}=\\text{O}', insert: '=' },
  { name: 'Triple bond', keywords: ['bond', 'equiv', 'chemistry'], category: 'Chemistry', preview: '\\text{N}\\equiv\\text{N}', insert: '\\equiv ' },
  { name: 'Radical dot', keywords: ['free radical', 'unpaired electron', 'chemistry'], category: 'Chemistry', preview: '\\text{Cl}^{\\bullet}', insert: '^{\\bullet}' },
  { name: 'Centred dot (hydrate)', keywords: ['hydrate', 'cdot', 'chemistry'], category: 'Chemistry', preview: '\\text{CuSO}_4\\cdot 5\\text{H}_2\\text{O}', insert: '\\cdot ' },
  { name: 'Enthalpy change', keywords: ['delta H', 'heat', 'thermodynamics', 'chemistry'], category: 'Chemistry', preview: '\\Delta H', insert: '\\Delta H' },
  { name: 'Electron', keywords: ['e minus', 'chemistry', 'physics'], category: 'Chemistry', preview: 'e^{-}', insert: 'e^{-}' },
  { name: 'Isotope notation', keywords: ['mass number', 'atomic number', 'nuclide', 'chemistry'], category: 'Chemistry', preview: '{}^{14}_{6}\\text{C}', insert: '{}^{‸}_{}\\text{}' },
  { name: 'Concentration [ ]', keywords: ['molarity', 'concentration', 'chemistry'], category: 'Chemistry', preview: '[\\text{H}^{+}]', insert: '[‸]' },
  { name: 'Equilibrium arrows (long)', keywords: ['reversible', 'long', 'chemistry'], category: 'Chemistry', preview: '\\rightleftharpoons', insert: '\\rightleftharpoons ' },

  // --- Geometry ---
  { name: 'Angle (∠)', keywords: ['angle', 'geometry'], category: 'Geometry', preview: '\\angle ABC', insert: '\\angle ‸' },
  { name: 'Measured angle', keywords: ['measured angle', 'geometry'], category: 'Geometry', preview: '\\measuredangle', insert: '\\measuredangle ' },
  { name: 'Perpendicular (⊥)', keywords: ['perp', 'right angle', 'geometry'], category: 'Geometry', preview: 'AB \\perp CD', insert: '\\perp ' },
  { name: 'Parallel (∥)', keywords: ['parallel', 'geometry'], category: 'Geometry', preview: 'AB \\parallel CD', insert: '\\parallel ' },
  { name: 'Triangle', keywords: ['triangle', 'geometry'], category: 'Geometry', preview: '\\triangle ABC', insert: '\\triangle ‸' },
  { name: 'Congruent (≅)', keywords: ['cong', 'congruent', 'geometry'], category: 'Geometry', preview: '\\cong', insert: '\\cong ' },
  { name: 'Similar (∼)', keywords: ['similar', 'geometry'], category: 'Geometry', preview: '\\sim', insert: '\\sim ' },
  { name: 'Degree (°)', keywords: ['angle', 'degree', 'geometry'], category: 'Geometry', preview: '90^{\\circ}', insert: '^{\\circ}' },
  { name: 'Line segment', keywords: ['overline', 'segment', 'geometry'], category: 'Geometry', preview: '\\overline{AB}', insert: '\\overline{‸}' },
  { name: 'Ray / line vector', keywords: ['overrightarrow', 'ray', 'geometry'], category: 'Geometry', preview: '\\overrightarrow{AB}', insert: '\\overrightarrow{‸}' },
  { name: 'Arc', keywords: ['arc', 'frown', 'geometry'], category: 'Geometry', preview: '\\overset{\\frown}{AB}', insert: '\\overset{\\frown}{‸}' },
  { name: 'Square', keywords: ['square', 'geometry'], category: 'Geometry', preview: '\\square', insert: '\\square ' },

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
  { name: 'Rationals', keywords: ['blackboard', 'Q'], category: 'Sets & logic', preview: '\\mathbb{Q}', insert: '\\mathbb{Q}' },
  { name: 'Complex numbers', keywords: ['blackboard', 'C'], category: 'Sets & logic', preview: '\\mathbb{C}', insert: '\\mathbb{C}' },
  { name: 'Superset', keywords: ['supset'], category: 'Sets & logic', preview: '\\supset', insert: '\\supset ' },
  { name: 'Superset or equal', keywords: ['supseteq'], category: 'Sets & logic', preview: '\\supseteq', insert: '\\supseteq ' },
  { name: 'Not a subset', keywords: ['nsubseteq'], category: 'Sets & logic', preview: '\\nsubseteq', insert: '\\nsubseteq ' },
  { name: 'Contains element', keywords: ['ni', 'owns'], category: 'Sets & logic', preview: '\\ni', insert: '\\ni ' },
  { name: 'Set difference', keywords: ['setminus', 'without'], category: 'Sets & logic', preview: 'A \\setminus B', insert: '\\setminus ' },
  { name: 'Complement', keywords: ['complement'], category: 'Sets & logic', preview: 'A^{\\complement}', insert: '^{\\complement}' },
  { name: 'Logical AND', keywords: ['land', 'wedge', 'conjunction'], category: 'Sets & logic', preview: '\\land', insert: '\\land ' },
  { name: 'Logical OR', keywords: ['lor', 'vee', 'disjunction'], category: 'Sets & logic', preview: '\\lor', insert: '\\lor ' },
  { name: 'Logical NOT', keywords: ['neg', 'lnot', 'negation'], category: 'Sets & logic', preview: '\\neg', insert: '\\neg ' },
  { name: 'Entails / turnstile', keywords: ['vdash', 'proves'], category: 'Sets & logic', preview: '\\vdash', insert: '\\vdash ' },
  { name: 'Models', keywords: ['models', 'satisfies'], category: 'Sets & logic', preview: '\\models', insert: '\\models ' },
  { name: 'Aleph', keywords: ['aleph', 'cardinality', 'infinity'], category: 'Sets & logic', preview: '\\aleph', insert: '\\aleph ' },

  // --- Functions ---
  { name: 'sin', keywords: ['trig', 'sine'], category: 'Functions', preview: '\\sin', insert: '\\sin ' },
  { name: 'cos', keywords: ['trig', 'cosine'], category: 'Functions', preview: '\\cos', insert: '\\cos ' },
  { name: 'tan', keywords: ['trig', 'tangent'], category: 'Functions', preview: '\\tan', insert: '\\tan ' },
  { name: 'log', keywords: ['logarithm'], category: 'Functions', preview: '\\log', insert: '\\log ' },
  { name: 'ln', keywords: ['natural log'], category: 'Functions', preview: '\\ln', insert: '\\ln ' },
  { name: 'exp', keywords: ['exponential'], category: 'Functions', preview: '\\exp', insert: '\\exp ' },
  { name: 'log base', keywords: ['logarithm subscript'], category: 'Functions', preview: '\\log_{2}', insert: '\\log_{‸}' },
  { name: 'cosec / csc', keywords: ['trig', 'cosecant'], category: 'Functions', preview: '\\csc', insert: '\\csc ' },
  { name: 'sec', keywords: ['trig', 'secant'], category: 'Functions', preview: '\\sec', insert: '\\sec ' },
  { name: 'cot', keywords: ['trig', 'cotangent'], category: 'Functions', preview: '\\cot', insert: '\\cot ' },
  { name: 'arcsin', keywords: ['trig', 'inverse sine'], category: 'Functions', preview: '\\arcsin', insert: '\\arcsin ' },
  { name: 'arccos', keywords: ['trig', 'inverse cosine'], category: 'Functions', preview: '\\arccos', insert: '\\arccos ' },
  { name: 'arctan', keywords: ['trig', 'inverse tangent'], category: 'Functions', preview: '\\arctan', insert: '\\arctan ' },
  { name: 'sinh', keywords: ['hyperbolic'], category: 'Functions', preview: '\\sinh', insert: '\\sinh ' },
  { name: 'cosh', keywords: ['hyperbolic'], category: 'Functions', preview: '\\cosh', insert: '\\cosh ' },
  { name: 'tanh', keywords: ['hyperbolic'], category: 'Functions', preview: '\\tanh', insert: '\\tanh ' },
  { name: 'max', keywords: ['maximum'], category: 'Functions', preview: '\\max', insert: '\\max ' },
  { name: 'min', keywords: ['minimum'], category: 'Functions', preview: '\\min', insert: '\\min ' },
  { name: 'gcd', keywords: ['greatest common divisor', 'hcf'], category: 'Functions', preview: '\\gcd', insert: '\\gcd ' },
  { name: 'det', keywords: ['determinant'], category: 'Functions', preview: '\\det', insert: '\\det ' },
  { name: 'mod', keywords: ['modulo', 'remainder'], category: 'Functions', preview: 'a \\bmod b', insert: '\\bmod ' },

  // --- Structures ---
  { name: '2×2 matrix', keywords: ['matrix', 'array'], category: 'Structures', preview: '\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}', insert: '\\begin{pmatrix} ‸ & \\\\ & \\end{pmatrix}' },
  { name: 'Determinant', keywords: ['matrix', 'vmatrix'], category: 'Structures', preview: '\\begin{vmatrix}a&b\\\\c&d\\end{vmatrix}', insert: '\\begin{vmatrix} ‸ & \\\\ & \\end{vmatrix}' },
  { name: 'Cases', keywords: ['piecewise', 'branches'], category: 'Structures', preview: 'f(x)=\\begin{cases}a\\\\b\\end{cases}', insert: '\\begin{cases} ‸ & \\\\ & \\end{cases}' },
  { name: 'Binomial', keywords: ['choose', 'nCr', 'combination'], category: 'Structures', preview: '\\binom{n}{k}', insert: '\\binom{‸}{}' },
  { name: 'Parentheses (auto)', keywords: ['brackets', 'left right'], category: 'Structures', preview: '\\left( x \\right)', insert: '\\left( ‸ \\right)' },
  { name: 'Overbrace', keywords: ['annotate'], category: 'Structures', preview: '\\overbrace{a+b}', insert: '\\overbrace{‸}' },
  { name: 'Underbrace', keywords: ['annotate', 'group'], category: 'Structures', preview: '\\underbrace{a+b}_{s}', insert: '\\underbrace{‸}_{}' },
  { name: '3×3 matrix', keywords: ['matrix', 'array'], category: 'Structures', preview: '\\begin{pmatrix}a&b&c\\\\d&e&f\\\\g&h&i\\end{pmatrix}', insert: '\\begin{pmatrix} ‸ & & \\\\ & & \\\\ & & \\end{pmatrix}' },
  { name: 'Bracket matrix', keywords: ['matrix', 'bmatrix', 'square'], category: 'Structures', preview: '\\begin{bmatrix}a&b\\\\c&d\\end{bmatrix}', insert: '\\begin{bmatrix} ‸ & \\\\ & \\end{bmatrix}' },
  { name: 'Column vector', keywords: ['vector', 'matrix'], category: 'Structures', preview: '\\begin{pmatrix}x\\\\y\\\\z\\end{pmatrix}', insert: '\\begin{pmatrix} ‸ \\\\ \\\\ \\end{pmatrix}' },
  { name: 'Aligned stack', keywords: ['align', 'substack', 'limits'], category: 'Structures', preview: '\\substack{i=1\\\\j=2}', insert: '\\substack{‸ \\\\ }' },

  // --- Brackets ---
  { name: 'Parentheses (auto)', keywords: ['round', 'left right', 'brackets'], category: 'Brackets', preview: '\\left( x \\right)', insert: '\\left( ‸ \\right)' },
  { name: 'Square brackets (auto)', keywords: ['square', 'left right'], category: 'Brackets', preview: '\\left[ x \\right]', insert: '\\left[ ‸ \\right]' },
  { name: 'Curly braces (auto)', keywords: ['brace', 'set', 'left right'], category: 'Brackets', preview: '\\left\\{ x \\right\\}', insert: '\\left\\{ ‸ \\right\\}' },
  { name: 'Absolute value', keywords: ['modulus', 'magnitude', 'abs'], category: 'Brackets', preview: '\\left| x \\right|', insert: '\\left| ‸ \\right|' },
  { name: 'Norm', keywords: ['magnitude', 'length', 'double bar'], category: 'Brackets', preview: '\\left\\| v \\right\\|', insert: '\\left\\| ‸ \\right\\|' },
  { name: 'Floor', keywords: ['round down', 'greatest integer'], category: 'Brackets', preview: '\\left\\lfloor x \\right\\rfloor', insert: '\\left\\lfloor ‸ \\right\\rfloor' },
  { name: 'Ceiling', keywords: ['round up'], category: 'Brackets', preview: '\\left\\lceil x \\right\\rceil', insert: '\\left\\lceil ‸ \\right\\rceil' },
  { name: 'Angle brackets', keywords: ['langle', 'inner product', 'average', 'bra ket'], category: 'Brackets', preview: '\\left\\langle x \\right\\rangle', insert: '\\left\\langle ‸ \\right\\rangle' },

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
