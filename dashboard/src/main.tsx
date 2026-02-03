import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { useServiceWorker } from './hooks/useServiceWorker'

// Register service worker for PWA
function ServiceWorkerRegistration() {
  useServiceWorker()
  return null
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ServiceWorkerRegistration />
    <App />
  </StrictMode>,
)
