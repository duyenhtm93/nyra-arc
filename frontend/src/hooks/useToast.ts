import { toast } from "sonner";
import { useCallback, useMemo } from "react";

export function useToast() {
  const showSuccess = useCallback((message: string, description?: string) => {
    toast.success(message, {
      description,
      duration: 4000,
    });
  }, []);

  const showError = useCallback((message: string, description?: string) => {
    toast.error(message, {
      description,
      duration: 6000,
    });
  }, []);

  const showLoading = useCallback((message: string, description?: string) => {
    return toast.loading(message, {
      description,
    });
  }, []);

  const showInfo = useCallback((message: string, description?: string) => {
    toast.info(message, {
      description,
      duration: 4000,
    });
  }, []);

  const showWarning = useCallback((message: string, description?: string) => {
    toast.warning(message, {
      description,
      duration: 5000,
    });
  }, []);

  const dismiss = useCallback((toastId?: string | number) => {
    toast.dismiss(toastId);
  }, []);

  // Transaction-specific toasts
  const showTransactionSuccess = useCallback((txHash: string, action: string) => {
    // Only show toast if we have a valid txHash
    if (!txHash || txHash.length < 10) {
      console.warn("Invalid txHash provided to showTransactionSuccess:", txHash);
      return;
    }

    toast.success(`${action} Successful!`, {
      description: `Transaction: ${txHash.slice(0, 10)}...${txHash.slice(-8)}`,
      duration: 5000,
      action: {
        label: "View on Explorer",
        onClick: () => {
          window.open(`https://testnet.arcscan.app/tx/${txHash}`, '_blank');
        },
      },
    });
  }, []);

  const showTransactionError = useCallback((error: string, action: string) => {
    // Only show toast if we have a valid error message
    if (!error || error.trim() === '') {
      console.warn("Invalid error message provided to showTransactionError:", error);
      return;
    }

    toast.error(`${action} Failed`, {
      description: error,
      duration: 6000,
    });
  }, []);

  const showTransactionPending = useCallback((action: string) => {
    // Only show loading toast if we have a valid action
    if (!action || action.trim() === '') {
      console.warn("Invalid action provided to showTransactionPending:", action);
      return null;
    }

    return toast.loading(`${action} in Progress...`, {
      description: "Please wait while we process your transaction",
    });
  }, []);

  // Wallet-specific toasts
  const showWalletConnected = useCallback((address: string) => {
    toast.success("Wallet Connected!", {
      description: `${address.slice(0, 6)}...${address.slice(-4)}`,
      duration: 3000,
    });
  }, []);

  const showWalletDisconnected = useCallback(() => {
    toast.info("Wallet Disconnected", {
      duration: 3000,
    });
  }, []);

  const showNetworkSwitched = useCallback((networkName: string) => {
    toast.success(`Switched to ${networkName}`, {
      duration: 3000,
    });
  }, []);

  const showNetworkError = useCallback((error: string) => {
    toast.error("Network Switch Failed", {
      description: error,
      duration: 5000,
    });
  }, []);

  return useMemo(() => ({
    // Basic toasts
    showSuccess,
    showError,
    showLoading,
    showInfo,
    showWarning,
    dismiss,

    // Transaction toasts
    showTransactionSuccess,
    showTransactionError,
    showTransactionPending,

    // Wallet toasts
    showWalletConnected,
    showWalletDisconnected,
    showNetworkSwitched,
    showNetworkError,
  }), [
    showSuccess, showError, showLoading, showInfo, showWarning, dismiss,
    showTransactionSuccess, showTransactionError, showTransactionPending,
    showWalletConnected, showWalletDisconnected, showNetworkSwitched, showNetworkError
  ]);
}
