import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

type ErrorBoundaryState = {
  hasError: boolean;
  message: string;
  stack: string;
};

class ErrorBoundary extends React.Component<
  React.PropsWithChildren,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = {
    hasError: false,
    message: '',
    stack: '',
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'Unknown runtime error',
      stack: error?.stack || '',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('AARVI runtime error:', error, info);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div
        style={{
          minHeight: '100dvh',
          width: '100%',
          background: '#020617',
          color: '#e2e8f0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            width: 'min(720px, 100%)',
            background: '#0f172a',
            border: '1px solid #334155',
            borderRadius: '16px',
            padding: '20px',
            boxSizing: 'border-box',
          }}
        >
          <div style={{ color: '#34d399', fontWeight: 800, fontSize: '18px', marginBottom: '8px' }}>
            AARVI Runtime Error
          </div>
          <div style={{ color: '#fca5a5', fontWeight: 700, marginBottom: '12px', wordBreak: 'break-word' }}>
            {this.state.message}
          </div>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: '280px',
              overflow: 'auto',
              color: '#94a3b8',
              fontSize: '12px',
              margin: '0 0 16px',
            }}
          >
            {this.state.stack}
          </pre>
          <button
            type="button"
            onClick={this.handleReload}
            style={{
              border: 0,
              borderRadius: '10px',
              padding: '10px 16px',
              background: '#10b981',
              color: '#020617',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            Reload App
          </button>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
