import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorFallback } from './error-fallback.js';

type ErrorBoundaryProps = {
  children: ReactNode;
  /**
   * When any value in this list changes, a caught error is cleared and children re-render. Pass the
   * inputs whose change means "the failure no longer applies" (e.g. the PDF file being previewed).
   */
  resetKeys?: readonly unknown[];
  /** Render your own fallback from the caught error + a reset callback. Defaults to `ErrorFallback`. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
};

type ErrorBoundaryState = { error: Error | null };

function keysChanged(a: readonly unknown[] = [], b: readonly unknown[] = []): boolean {
  return a.length !== b.length || a.some((value, i) => !Object.is(value, b[i]));
}

/**
 * The one React error boundary. Catches render/lifecycle/effect errors from its subtree — including
 * react-pdf's synchronous `getPage` throw when the PDF transport is torn down mid-navigation — and
 * shows a recoverable {@link ErrorFallback} instead of letting the error crash the whole app. Wrap a
 * risky region and give it `resetKeys` so the boundary self-heals when its inputs change.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  override componentDidUpdate(prev: ErrorBoundaryProps): void {
    if (this.state.error && keysChanged(prev.resetKeys, this.props.resetKeys)) {
      this.reset();
    }
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (error) {
      return this.props.fallback ? (
        this.props.fallback(error, this.reset)
      ) : (
        <ErrorFallback detail={error.message} onRetry={this.reset} />
      );
    }
    return this.props.children;
  }
}
