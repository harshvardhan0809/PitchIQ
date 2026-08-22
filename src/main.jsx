import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { AppConfigProvider } from './lib/appConfig'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AppConfigProvider>
        <App />
      </AppConfigProvider>
    </BrowserRouter>
  </StrictMode>,
)
