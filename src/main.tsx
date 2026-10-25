import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AudioLabRoute } from './components/AudioLabRoute'

const isAudioLab = window.location.search.includes('audiotest')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isAudioLab ? <AudioLabRoute /> : <App />}
  </StrictMode>,
)
