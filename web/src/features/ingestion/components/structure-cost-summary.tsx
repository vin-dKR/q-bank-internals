import { useState, type JSX } from 'react';
import type { StructureCostController } from '../hooks/use-structure-cost.js';
import { IconRupee, ToolbarHelp } from '../../../shared/ui/index.js';
import { useStructureExchangeRate } from '../hooks/use-structure-exchange-rate.js';
import { formatStructureCostInr } from '../lib/structure-cost-format.js';
import { USD_INR_RATE_URL } from '../api/structure-exchange-rate.api.js';

const tokens = (value: number): string => value.toLocaleString();

export function StructureCostSummary({
  cost,
  hasPdf,
}: {
  cost: StructureCostController;
  hasPdf: boolean;
}): JSX.Element | null {
  const [requested, setRequested] = useState(false);
  const exchangeRate = useStructureExchangeRate(requested);
  const inr = (usd: number): string => {
    if (usd === 0) return formatStructureCostInr(0, 1);
    if (exchangeRate.data) return formatStructureCostInr(usd, exchangeRate.data.rate);
    return exchangeRate.isError ? 'INR unavailable' : 'Loading INR rate…';
  };
  const { estimate, estimateError, receipts } = cost;
  if (!hasPdf && receipts.length === 0) return null;
  const last = receipts.at(-1);
  const known = receipts.filter((receipt) => receipt !== null);
  const totalTokens = known.reduce((sum, receipt) => sum + receipt.totalTokens, 0);
  const totalCost = known.reduce((sum, receipt) => sum + (receipt.costUsd ?? 0), 0);
  const completeCost =
    known.length === receipts.length && known.every((receipt) => receipt.costUsd !== null);
  return (
    <ToolbarHelp
      label="Estimated AI cost in INR"
      icon={<IconRupee />}
      width={360}
      onOpen={() => {
        setRequested(true);
      }}
    >
      <div className="space-y-2" aria-live="polite">
        {estimate ? (
          <>
            <p className="font-semibold text-ink">
              Estimated cost per detection:{' '}
              {estimate.costUsd
                ? `${inr(estimate.costUsd.min)}–${inr(estimate.costUsd.max)}`
                : 'Pricing unavailable'}
            </p>
            <p>
              {estimate.model} · {estimate.cropCount} crops · {estimate.callCount} text-only AI
              calls
            </p>
            <p className="text-ink-3">
              Estimate from saved crop text. Actual usage can fall outside this range. OCR uses no
              AI tokens.
            </p>
            <p>
              Input: ~{tokens(estimate.inputTokens.min)}–{tokens(estimate.inputTokens.max)} tokens
              <br />
              Output: ~{tokens(estimate.outputTokens.min)}–{tokens(estimate.outputTokens.max)}{' '}
              tokens
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
                  Per 1M tokens: {inr(estimate.pricing.inputPerMillion)} input ·{' '}
                  {inr(estimate.pricing.cachedInputPerMillion)} cached input ·{' '}
                  {inr(estimate.pricing.outputPerMillion)} output.{' '}
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
                  {last.costUsd === null ? 'Pricing unavailable' : inr(last.costUsd)}
                </p>
              </>
            ) : (
              <p>The provider did not return token usage for this detection.</p>
            )}
            <p className="font-semibold">
              This PDF: {known.reduce((sum, receipt) => sum + receipt.callCount, 0)} reported calls
              · {tokens(totalTokens)} reported tokens ·{' '}
              {completeCost
                ? inr(totalCost)
                : `${inr(totalCost)} known cost; some usage or pricing is unavailable`}
            </p>
            <p className="text-ink-3">
              Structure detection only. Totals cover this loaded PDF in this browser session; costs
              use published API rates.
            </p>
          </div>
        ) : null}
        {exchangeRate.data ? (
          <p className="border-t border-line pt-2 text-ink-3">
            1 USD ≈ {formatStructureCostInr(1, exchangeRate.data.rate)} · rate dated{' '}
            {exchangeRate.data.date}.{' '}
            <a href={USD_INR_RATE_URL} target="_blank" rel="noreferrer" className="underline">
              Exchange rate
            </a>
            . INR figures are estimates; provider billing is in USD.
          </p>
        ) : exchangeRate.isError ? (
          <div role="status" className="text-amber-700">
            INR conversion is unavailable.{' '}
            <button
              type="button"
              className="underline"
              onClick={() => {
                void exchangeRate.refetch();
              }}
            >
              Retry conversion
            </button>
          </div>
        ) : (
          <p role="status" className="text-ink-3">
            Loading USD-to-INR exchange rate…
          </p>
        )}
      </div>
    </ToolbarHelp>
  );
}
