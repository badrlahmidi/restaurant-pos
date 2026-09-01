import React from "react";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /**
   * When any value in this array changes, a caught error is cleared and the
   * children are re-rendered. Used by RouteErrorBoundary to recover on navigation.
   */
  resetKeys?: ReadonlyArray<unknown>;
  /** Heading shown on the fallback screen. */
  title?: string;
  /** Fill the viewport (top-level boundary) vs. sit inside the current layout. */
  fullscreen?: boolean;
  /** Side-effect hook for logging / reporting. Never throw from here. */
  onError?: (error: Error, info: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

const keysChanged = (
  a: ReadonlyArray<unknown> = [],
  b: ReadonlyArray<unknown> = [],
): boolean => a.length !== b.length || a.some((value, index) => !Object.is(value, b[index]));

/**
 * Catches render/lifecycle errors in the subtree so a single component fault
 * cannot blank the whole terminal. Deliberately free of i18n / context / router
 * dependencies so it still renders when those are the thing that broke.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("[ErrorBoundary]", error, info.componentStack);
    try {
      this.props.onError?.(error, info);
    } catch {
      // reporting must never mask the original error
    }
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (this.state.error && keysChanged(prevProps.resetKeys, this.props.resetKeys)) {
      this.reset();
    }
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  private reload = (): void => {
    window.location.reload();
  };

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }

    const { title = "Something went wrong on this screen", fullscreen = false } = this.props;

    return (
      <div
        role="alert"
        className={
          fullscreen
            ? "flex min-h-screen items-center justify-center bg-neutral-100 p-6"
            : "flex min-h-[240px] items-center justify-center bg-neutral-100 p-6"
        }
      >
        <div className="w-full max-w-md rounded-md border border-neutral-200 bg-white p-6 text-center shadow-sm">
          <h1 className="mb-2 text-lg font-semibold text-neutral-900">{title}</h1>
          <p className="mb-5 text-sm text-neutral-600">
            The rest of the app is still running. Try this screen again, or reload if it keeps failing.
          </p>
          <div className="flex justify-center gap-3">
            <button
              type="button"
              onClick={this.reset}
              className="rounded-md border border-primary-600 px-4 py-2 text-sm font-medium text-primary-700 transition-colors hover:bg-primary-100"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={this.reload}
              className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700"
            >
              Reload app
            </button>
          </div>
          <details className="mt-5 text-left">
            <summary className="cursor-pointer text-xs text-neutral-500">Technical details</summary>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-neutral-50 p-2 text-[11px] text-neutral-700">
              {error.message}
              {error.stack ? `\n\n${error.stack}` : ""}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
