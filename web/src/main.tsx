import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

// Global styles
const style = document.createElement("style");
style.textContent = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0d1117; color: #f0f4ff; font-family: 'Inter','Roboto',sans-serif; }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.25); }
  @keyframes fadeIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
  .react-flow__handle {
    transition: all 0.15s ease !important;
  }
  .react-flow__handle:hover {
    transform: scale(1.6) !important;
    box-shadow: 0 0 18px rgba(255,255,255,1) !important;
  }
  .react-flow__node:hover .react-flow__handle {
    opacity: 1 !important;
  }
  .react-flow__edge-path {
    filter: drop-shadow(0 0 4px rgba(255,255,255,0.3));
  }
`;
document.head.appendChild(style);

createRoot(document.getElementById("root")!).render(
  <StrictMode><App /></StrictMode>
);