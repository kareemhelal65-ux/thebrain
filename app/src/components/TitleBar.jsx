import React from 'react';
import { Minus, Square, X, Brain } from 'lucide-react';

export default function TitleBar() {
  const handleMinimize = () => {
    if (window.electronAPI) window.electronAPI.minimize();
  };

  const handleMaximize = () => {
    if (window.electronAPI) window.electronAPI.maximize();
  };

  const handleClose = () => {
    if (window.electronAPI) window.electronAPI.close();
  };

  return (
    <div className="h-10 flex items-center justify-between drag-region bg-abyss border-b border-border-subtle shrink-0">
      {/* Brand & Breadcrumbs */}
      <div className="flex items-center gap-3 px-4 no-drag">
        <div className="w-5 h-5 flex items-center justify-center rounded bg-primary-dim text-primary">
          <Brain size={14} />
        </div>
        <span className="text-xs font-semibold tracking-wider text-text-main">THE BRAIN AIOS</span>
        <div className="w-px h-3 bg-border-raised mx-1"></div>
        <span className="text-[10px] font-mono tracking-widest text-text-dim uppercase">Control Room v2.0</span>
      </div>

      {/* Center - optional status indicator can go here */}

      {/* Window Controls */}
      <div className="flex items-center h-full no-drag text-text-muted">
        <button 
          onClick={handleMinimize}
          className="h-full px-4 hover:bg-surface-hover hover:text-text-main transition-colors flex items-center justify-center"
        >
          <Minus size={14} />
        </button>
        <button 
          onClick={handleMaximize}
          className="h-full px-4 hover:bg-surface-hover hover:text-text-main transition-colors flex items-center justify-center"
        >
          <Square size={12} />
        </button>
        <button 
          onClick={handleClose}
          className="h-full px-4 hover:bg-danger-dim hover:text-danger transition-colors flex items-center justify-center"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
