import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import RenderHost from './designer/render/RenderHost.tsx'
import './index.css'

// The hidden export window loads #render: it only draws export jobs (electron/renderWindow.js).
// It shares index.css with the app so cards lay out exactly as in the Designer.
const root = ReactDOM.createRoot(document.getElementById('root'))
if (window.location.hash === '#render') {
  root.render(<RenderHost />)
} else {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}
