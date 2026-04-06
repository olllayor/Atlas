import type { ErrorInfo, ReactNode } from 'react';
import { Component } from 'react';

type RendererErrorBoundaryProps = {
  children: ReactNode;
  fallback?: ReactNode;
  resetKey?: string | null;
};

type RendererErrorBoundaryState = {
  error: Error | null;
};

export class RendererErrorBoundary extends Component<
  RendererErrorBoundaryProps,
  RendererErrorBoundaryState
> {
  state: RendererErrorBoundaryState = {
    error: null
  };

  static getDerivedStateFromError(error: Error): RendererErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Renderer boundary caught an error.', error, errorInfo);
  }

  override componentDidUpdate(prevProps: RendererErrorBoundaryProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  override render() {
    if (this.state.error) {
      return (
        this.props.fallback ?? (
          <div className="flex min-h-0 flex-1 items-center justify-center px-8 py-10 lg:px-12">
            <div className="w-full max-w-xl rounded-[24px] border border-error-border bg-error-bg p-6 shadow-elevated">
              <h2 className="text-lg font-normal text-error-text">Conversation view failed to render</h2>
              <p className="mt-2 text-sm text-error-text/80">
                The app recovered instead of leaving the window blank. Switching sessions again will retry this view.
              </p>
              <pre className="app-code-text mt-4 overflow-x-auto rounded-2xl border border-error-border/60 bg-black/20 px-4 py-3 text-error-text/80">
                {this.state.error.message}
              </pre>
            </div>
          </div>
        )
      );
    }

    return this.props.children;
  }
}
