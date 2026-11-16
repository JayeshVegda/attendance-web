import React, { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error in component tree:', error, errorInfo)
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }
      return (
        <div className="min-h-[50vh] flex items-center justify-center p-6">
          <div className="w-full max-w-md rounded-2xl border border-rose-200 bg-rose-50/90 p-6 text-center shadow-lg">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 text-rose-600 mb-3 text-xl font-black">
              ⚠
            </div>
            <h1 className="text-base font-bold text-rose-950">Something went wrong</h1>
            <p className="mt-1 text-xs text-rose-800 break-words">
              {this.state.error?.message || 'An unexpected rendering error occurred.'}
            </p>
            <div className="mt-4 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => this.setState({ hasError: false, error: null })}
                className="rounded-lg bg-rose-600 px-4 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-rose-700 transition cursor-pointer"
              >
                Try Again
              </button>
              <button
                type="button"
                onClick={() => {
                  window.location.hash = ''
                  this.setState({ hasError: false, error: null })
                }}
                className="rounded-lg border border-rose-300 bg-white px-4 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-50 transition cursor-pointer"
              >
                Go to Attendance
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
