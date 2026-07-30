import type { ErrorInfo, ReactNode } from 'react';
import { Component } from 'react';

type RendererErrorBoundaryProps = {
  children: ReactNode;
  fallback?: ReactNode;
  resetKey?: string | null;
};

type RendererErrorBoundaryState = {
  error: Error | null;
  componentStack: string | null;
  copied: boolean;
};

const INITIAL_STATE: RendererErrorBoundaryState = {
  error: null,
  componentStack: null,
  copied: false
};

export class RendererErrorBoundary extends Component<
  RendererErrorBoundaryProps,
  RendererErrorBoundaryState
> {
  state: RendererErrorBoundaryState = INITIAL_STATE;

  private copyResetTimer: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError(error: Error): Partial<RendererErrorBoundaryState> {
    return { error, copied: false };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Renderer boundary caught an error.', error, errorInfo);
    this.setState({ componentStack: errorInfo.componentStack ?? null });
  }

  override componentDidUpdate(prevProps: RendererErrorBoundaryProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.reset();
    }
  }

  override componentWillUnmount() {
    if (this.copyResetTimer) {
      clearTimeout(this.copyResetTimer);
    }
  }

  private reset = () => {
    if (this.copyResetTimer) {
      clearTimeout(this.copyResetTimer);
      this.copyResetTimer = null;
    }

    this.setState(INITIAL_STATE);
  };

  private buildDetails() {
    const { error, componentStack } = this.state;

    return [error?.stack ?? error?.message ?? 'Unknown error', componentStack]
      .filter(Boolean)
      .join('\n\n');
  }

  private copyDetails = () => {
    void navigator.clipboard
      .writeText(this.buildDetails())
      .then(() => {
        this.setState({ copied: true });
        this.copyResetTimer = setTimeout(() => {
          this.copyResetTimer = null;
          this.setState({ copied: false });
        }, 2000);
      })
      .catch((copyError: unknown) => {
        console.error('Failed to copy error details.', copyError);
      });
  };

  override render() {
    const { error, copied } = this.state;

    if (!error) {
      return this.props.children;
    }

    if (this.props.fallback) {
      return this.props.fallback;
    }

    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-8 py-10 lg:px-12">
        <div className="w-full max-w-xl rounded-xl border border-border-default bg-bg-elevated p-6 shadow-elevated">
          <h2 className="text-base font-normal text-text-primary">This view stopped rendering</h2>
          <p className="mt-1.5 text-sm text-text-secondary">
            Nothing was lost. Try again, or copy the details if it keeps happening.
          </p>

          <p className="mt-4 truncate text-sm text-error" title={error.message}>
            {error.message || 'Unknown error'}
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={this.reset}
              className="inline-flex h-8 items-center rounded-md border border-border-default bg-bg-button px-3 text-sm text-text-inverse transition-colors hover:bg-bg-button-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={this.copyDetails}
              className="inline-flex h-8 items-center rounded-md border border-border-default px-3 text-sm text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {copied ? 'Copied' : 'Copy details'}
            </button>
          </div>

          <details className="group mt-5">
            <summary className="cursor-pointer list-none text-xs text-text-tertiary transition-colors hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
              <span className="group-open:hidden">Show technical details</span>
              <span className="hidden group-open:inline">Hide technical details</span>
            </summary>
            <pre className="app-code-text mt-3 max-h-64 overflow-auto rounded-md border border-border-subtle bg-bg-code px-3 py-2.5 text-text-secondary">
              {this.buildDetails()}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
