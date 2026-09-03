import { fillTokens, resolvePrompt, type PromptOverrides } from '../../../modules/prompts/index.js';

/**
 * Diagram-detection prompt, ported from the Python image-auto-cropper
 * (`backend/services/openai_detector.py`). The default wording is faithful to the original — vision
 * models are sensitive to phrasing — but the operator can override it from the prompt settings; the
 * `{imgWidth}`/`{imgHeight}` tokens are filled with the page's pixel dimensions here.
 */
export function detectorPrompt(imgWidth: number, imgHeight: number, overrides: PromptOverrides): string {
  return fillTokens(resolvePrompt(overrides, 'detection'), { imgWidth, imgHeight });
}
