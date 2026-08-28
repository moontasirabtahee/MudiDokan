import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider } from '@/i18n/I18nProvider'
import { AuthProvider } from '@/providers/AuthProvider'
import { ShopProvider } from '@/providers/ShopProvider'
import { ToastProvider } from '@/providers/ToastProvider'
import App from './App'
import './index.css'

const container = document.getElementById('root')
if (!container) {
  throw new Error('Root element not found')
}

const root = createRoot(container)
root.render(
  <StrictMode>
    <I18nProvider>
      <AuthProvider>
        <ShopProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </ShopProvider>
      </AuthProvider>
    </I18nProvider>
  </StrictMode>,
)
