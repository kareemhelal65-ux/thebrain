import React, { useState } from 'react';
import TitleBar from './components/TitleBar';
import Sidebar from './components/Sidebar';
import { motion, AnimatePresence } from 'framer-motion';

import ChatView from './views/ChatView';
import AgentsView from './views/AgentsView';
import IntegrationsView from './views/IntegrationsView';

function App() {
  const [activeView, setActiveView] = useState('chat');

  // Render actual views
  const renderView = () => {
    switch (activeView) {
      case 'chat': return <ChatView />;
      case 'agents': return <AgentsView />;
      case 'integrations': return <IntegrationsView />;
      case 'dashboard': return <div className="p-8"><h1 className="text-2xl font-bold text-text-main">System Overview</h1><p className="text-text-muted mt-2">Dashboard widgets go here...</p></div>;
      case 'tools': return <div className="p-8"><h1 className="text-2xl font-bold text-text-main">Universal Registry</h1><p className="text-text-muted mt-2">Tools list goes here...</p></div>;
      case 'settings': return <div className="p-8"><h1 className="text-2xl font-bold text-text-main">Configuration</h1><p className="text-text-muted mt-2">Settings panels go here...</p></div>;
      default: return null;
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-void overflow-hidden">
      {/* Background Grids for texture */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.03] bg-[linear-gradient(rgba(255,255,255,1)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,1)_1px,transparent_1px)] bg-[size:32px_32px] z-0" />
      
      <TitleBar />
      
      <div className="flex-1 flex overflow-hidden relative z-10">
        <Sidebar activeView={activeView} setActiveView={setActiveView} />
        
        {/* Main Content Area */}
        <main className="flex-1 relative overflow-hidden bg-void">
          {/* Subtle glow behind content */}
          <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-primary/5 blur-[120px] rounded-full pointer-events-none" />
          <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-secondary/5 blur-[120px] rounded-full pointer-events-none" />
          
          <AnimatePresence mode="wait">
            <motion.div
              key={activeView}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="h-full w-full overflow-y-auto"
            >
              {renderView()}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}

export default App;
