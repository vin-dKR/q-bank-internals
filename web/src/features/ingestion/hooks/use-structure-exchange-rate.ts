import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { getStructureExchangeRate, type UsdInrRate } from '../api/structure-exchange-rate.api.js';

export function useStructureExchangeRate(enabled: boolean): UseQueryResult<UsdInrRate> {
  return useQuery({
    queryKey: ['structure-exchange-rate', 'USD', 'INR'],
    queryFn: getStructureExchangeRate,
    enabled,
    staleTime: 24 * 60 * 60 * 1000,
    retry: 1,
  });
}
