import { useQueryClient } from '@tanstack/react-query';

/**
 * Hook để invalidate (refresh) tất cả queries liên quan đến lending protocol
 * Gọi sau khi transaction thành công để update UI
 * 
 * Wagmi tự động tạo queryKey riêng cho từng contract call.
 * Thay vì dùng custom queryKey, ta invalidate toàn bộ wagmi queries.
 */
export function useInvalidateQueries() {
  const queryClient = useQueryClient();

  /**
   * Invalidate tất cả wagmi queries (readContract, readContracts)
   * Cách này đơn giản và hoạt động tốt với wagmi's built-in query keys
   */
  const invalidateAllUserData = (userAddress?: string) => {
    if (!userAddress) return;

    // Invalidate tất cả wagmi queries
    // Wagmi sử dụng queryKey format: ['readContract', { address, functionName, args, ... }]
    queryClient.invalidateQueries({ 
      predicate: (query) => {
        // Invalidate tất cả readContract và readContracts queries
        const key = query.queryKey as any[];
        return key[0] === 'readContract' || key[0] === 'readContracts';
      }
    });

  };

  /**
   * Invalidate supplies data only
   * (Vẫn giữ các function này để dễ mở rộng sau này)
   */
  const invalidateSupplies = (userAddress?: string) => {
    invalidateAllUserData(userAddress);
  };

  /**
   * Invalidate borrows data only
   */
  const invalidateBorrows = (userAddress?: string) => {
    invalidateAllUserData(userAddress);
  };

  /**
   * Invalidate collaterals data only
   */
  const invalidateCollaterals = (userAddress?: string) => {
    invalidateAllUserData(userAddress);
  };

  /**
   * Invalidate all borrowers list (for liquidation monitoring)
   */
  const invalidateBorrowersList = () => {
    invalidateAllUserData(undefined);
  };

  return {
    invalidateAllUserData,
    invalidateSupplies,
    invalidateBorrows,
    invalidateCollaterals,
    invalidateBorrowersList,
  };
}

