const rupees = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Keep provider billing in USD; convert only the displayed estimate and reported cost. */
export function formatStructureCostInr(usd: number, usdInrRate: number): string {
  return rupees.format(usd * usdInrRate);
}
