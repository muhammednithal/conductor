import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

const style = document.createElement("style");
style.textContent = `
  *, *::before, *::after { box-sizing: border-box; }
  html, body, #root { margin: 0; padding: 0; width: 100%; height: 100%; }
  body { background: #0d1117; color: #f0f4ff; font-family: 'Inter','Roboto',sans-serif; }

  /* Custom scrollbar */
  ::-webkit-scrollbar { width: 5px; height: 5px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }

  /* Fade-in animation */
  @keyframes fadeIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }

  /* React Flow — force dark theme on all built-in UI */
  .react-flow__background { background: #0d1117 !important; }
  .react-flow__controls {
    background: rgba(22,27,42,0.9) !important;
    border: 1px solid rgba(255,255,255,0.1) !important;
    border-radius: 10px !important;
    box-shadow: 0 4px 20px rgba(0,0,0,0.5) !important;
  }
  .react-flow__controls-button {
    background: transparent !important;
    border-bottom: 1px solid rgba(255,255,255,0.06) !important;
    fill: rgba(200,210,240,0.7) !important;
    width: 28px !important; height: 28px !important;
  }
  .react-flow__controls-button:hover {
    background: rgba(255,255,255,0.08) !important;
    fill: #fff !important;
  }
  .react-flow__controls-button:last-child { border-bottom: none !important; }
  .react-flow__edge-path { filter: drop-shadow(0 0 3px rgba(255,255,255,0.25)); }

  /* Handle glow on hover */
  .react-flow__handle { transition: transform 0.15s, box-shadow 0.15s !important; }
  .react-flow__handle:hover {
    transform: scale(1.7) !important;
    box-shadow: 0 0 16px rgba(255,255,255,1) !important;
  }
`;
document.head.appendChild(style);

createRoot(document.getElementById("root")!).render(
  <StrictMode><App /></StrictMode>
);