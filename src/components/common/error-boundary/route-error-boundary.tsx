import React from "react";
import { useLocation } from "react-router";
import { ErrorBoundary } from "@/components/common/error-boundary/error-boundary.tsx";

interface RouteErrorBoundaryProps {
  children: React.ReactNode;
}

/**
 * Per-screen error boundary. A caught error is confined to the current route and
 * automatically cleared when the user navigates elsewhere, so one broken screen
 * never takes down the whole POS.
 */
export const RouteErrorBoundary = ({ children }: RouteErrorBoundaryProps) => {
  const location = useLocation();
  return (
    <ErrorBoundary resetKeys={[location.pathname]} title="This screen ran into a problem">
      {children}
    </ErrorBoundary>
  );
};
