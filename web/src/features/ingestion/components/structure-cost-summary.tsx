import type { JSX } from 'react';
import type { StructureCostController } from '../hooks/use-structure-cost.js';

const tokens = (value: number): string => value.toLocaleString();
const dollars = (value: number): string => `$${value.toFixed(4)}`;

export function StructureCostSummary({
  cost,
  hasPdf,
}: {
  cost: StructureCostController;
  hasPdf: boolean;
}): JSX.Element | null {
  const { estimate, estimateError, receipts } = cost;
  if (!hasPdf && receipts.length === 0) return null;
  const last = receipts.at(-1);
  const known = receipts.filter((receipt) => receipt !== null);
  const totalTokens = known.reduce((sum, receipt) => sum + receipt.totalTokens, 0);
  const totalCost = known.reduce((sum, receipt) => sum + (receipt.costUsd ?? 0), 0);
  const completeCost =
    known.length === receipts.length && known.every((receipt) => receipt.costUsd !== null);
  return (
    <div
      className="space-y-2 rounded-md border border-brand/20 bg-surface-1 p-2 text-[12px] text-ink-2"
      aria-live="polite"
    >
      {estimate ? (
        <>
          <p className="font-semibold text-ink">
            Estimated cost per detection:{' '}
            {estimate.costUsd
              ? `${dollars(estimate.costUsd.min)}–${dollars(estimate.costUsd.max)} USD`
              : 'Pricing unavailable'}
          </p>
          <p>
            {estimate.model} · {estimate.cropCount} crops · {estimate.callCount} text-only AI calls
          </p>
          <p className="text-ink-3">
            Estimate from saved crop text. Actual usage can fall outside this range. OCR uses no AI
            tokens.
          </p>
          <p>
            Input: ~{tokens(estimate.inputTokens.min)}–{tokens(estimate.inputTokens.max)} tokens
            <br />
            Output: ~{tokens(estimate.outputTokens.min)}–{tokens(estimate.outputTokens.max)} tokens
          </p>
          <details>
            <summary className="cursor-pointer">Estimate assumptions and rates</summary>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {estimate.assumptions.map((assumption) => (
                <li key={assumption}>{assumption}</li>
              ))}
            </ul>
            {estimate.pricing ? (
              <p className="mt-1">
                Per 1M tokens: ${estimate.pricing.inputPerMillion} input · $
                {estimate.pricing.cachedInputPerMillion} cached input · $
                {estimate.pricing.outputPerMillion} output.{' '}
                <a
                  className="underline"
                  href={estimate.pricing.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  OpenAI rates
                </a>{' '}
                verified {estimate.pricing.verifiedAt}.
                {estimate.model === 'gpt-5.4'
                  ? ' Above 272K input tokens, input rates double and output rates increase by 50%.'
                  : ''}
              </p>
            ) : (
              <p className="mt-1">
                No verified rate is configured for this model. Token usage will still be shown.
              </p>
            )}
          </details>
        </>
      ) : (
        <p>
          {estimateError
            ? `Estimate unavailable: ${estimateError}`
            : 'Save reviewed OCR text to estimate AI tokens and cost.'}
        </p>
      )}
      {receipts.length > 0 ? (
        <div className="space-y-1 border-t border-brand/20 pt-2">
          <p className="font-semibold text-ink">Reported usage · latest AI request</p>
          {last ? (
            <>
              <p>
                {last.model} · {tokens(last.promptTokens)} input + {tokens(last.completionTokens)}{' '}
                output = {tokens(last.totalTokens)} tokens
              </p>
              <p>
                Cached input: {tokens(last.cachedPromptTokens)} · Reasoning:{' '}
                {tokens(last.reasoningTokens)} (included in output)
              </p>
              <p>
                Cost from reported tokens:{' '}
                {last.costUsd === null ? 'Pricing unavailable' : `${dollars(last.costUsd)} USD`}
              </p>
            </>
          ) : (
            <p>The provider did not return token usage for this detection.</p>
          )}
          <p className="font-semibold">
            This PDF: {known.reduce((sum, receipt) => sum + receipt.callCount, 0)} reported calls ·{' '}
            {tokens(totalTokens)} reported tokens ·{' '}
            {completeCost
              ? `${dollars(totalCost)} USD`
              : `${dollars(totalCost)} USD known cost; some usage or pricing is unavailable`}
          </p>
          <p className="text-ink-3">
            Structure detection only. Totals cover this loaded PDF in this browser session; costs
            use published API rates.
          </p>
        </div>
      ) : null}
    </div>
  );
}
