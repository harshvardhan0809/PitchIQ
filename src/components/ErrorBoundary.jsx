import { Component } from 'react'

/** Keeps a render fault in one panel from blanking the whole page. */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('PitchIQ render error:', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="panel error-panel">
        <h2>Something went wrong displaying this section.</h2>
        <p>{this.state.error.message}</p>
        <button type="button" onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    )
  }
}
