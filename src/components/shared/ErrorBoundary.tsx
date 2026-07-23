import { Component, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

// Without this, a render-time throw anywhere in the wrapped subtree unmounts
// it silently (React logs to console but nothing visible shows in the UI) —
// it just looks like the chart "disappeared". Catching it here at least
// surfaces the error and offers a way back instead of a blank panel.
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('OrgChart crashed:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm font-medium text-slate-700">Une erreur a interrompu l'affichage.</p>
          <p className="max-w-md text-xs text-slate-500">{this.state.error.message}</p>
          <button
            onClick={() => this.setState({ error: null })}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white"
          >
            Réessayer
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
