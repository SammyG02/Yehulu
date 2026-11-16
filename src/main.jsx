import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import '@fontsource-variable/manrope'
import './index.css'
import App from './App.jsx'
import { SavingsProvider } from './state/savings.jsx'
import { ThemeProvider } from './state/theme.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <SavingsProvider>
          <App />
        </SavingsProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
