import {
  useQuery,
  useMutation,
  useQueryClient,
  type QueryKey,
  type UseMutationOptions,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";

type InvokeQueryOptions<TQueryFnData, TData> = Omit<
  UseQueryOptions<TQueryFnData, Error, TData, QueryKey>,
  "queryKey" | "queryFn"
>;

/**
 * Hook for cached Tauri invoke calls using react-query
 * Data persists across tab switches, invalidated on app restart
 */
export function useInvokeQuery<TQueryFnData, TData = TQueryFnData>(
  queryKey: QueryKey,
  command: string,
  args?: Record<string, unknown>,
  options?: InvokeQueryOptions<TQueryFnData, TData>,
) {
  return useQuery<TQueryFnData, Error, TData, QueryKey>({
    queryKey,
    queryFn: () => invoke<TQueryFnData>(command, args),
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    ...options,
  });
}

type InvokeMutationOptions<T, V> = Omit<UseMutationOptions<T, Error, V>, "mutationFn">;

/**
 * Hook for Tauri invoke mutations with automatic cache invalidation
 */
export function useInvokeMutation<T, V = void>(
  command: string,
  invalidateKeys?: QueryKey[],
  options?: InvokeMutationOptions<T, V>,
) {
  const queryClient = useQueryClient();

  return useMutation<T, Error, V>({
    mutationFn: (variables) => invoke<T>(command, variables as Record<string, unknown>),
    ...options,
    onSuccess: (data, variables, context, mutation) => {
      options?.onSuccess?.(data, variables, context, mutation);
      invalidateKeys?.forEach((key) => {
        queryClient.invalidateQueries({ queryKey: key });
      });
    },
  });
}

/**
 * Re-export useQueryClient for manual invalidation
 */
export { useQueryClient };
