import React, { useState } from 'react';
import { Send, Sparkles, Brain } from 'lucide-react';
import { motion } from 'framer-motion';

export default function ChatView() {
  const [input, setInput] = useState('');

  return (
    <div className="flex flex-col h-full relative">
      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        
        <div className="flex items-center justify-center h-full flex-col opacity-60">
          <motion.div 
            animate={{ scale: [1, 1.05, 1], opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 4, repeat: Infinity }}
            className="w-16 h-16 rounded-2xl bg-primary-dim border border-primary/20 flex items-center justify-center shadow-[0_0_30px_rgba(0,242,255,0.2)] mb-4"
          >
            <Brain size={32} className="text-primary" />
          </motion.div>
          <h2 className="text-xl font-bold tracking-wide">Neural Link Initiated</h2>
          <p className="text-sm text-text-muted mt-2 font-mono">Ready to process commands.</p>
        </div>

      </div>

      {/* Input Area */}
      <div className="p-6 shrink-0 bg-gradient-to-t from-void to-transparent">
        <div className="max-w-3xl mx-auto relative group">
          {/* Animated Glow Border Effect */}
          <div className="absolute -inset-[1px] bg-gradient-to-r from-primary/30 via-secondary/30 to-primary/30 rounded-full blur-[2px] group-focus-within:blur-[4px] group-focus-within:opacity-100 opacity-50 transition-all duration-300 pointer-events-none" />
          
          <div className="relative flex items-center bg-abyss rounded-full border border-border-raised px-4 py-3 shadow-xl overflow-hidden">
            <input 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Message The Brain..."
              className="flex-1 bg-transparent border-none outline-none text-sm text-text-main placeholder-text-muted px-2"
            />
            <button className="w-8 h-8 rounded-full bg-primary text-void flex items-center justify-center hover:bg-[#33f5ff] transition-colors cursor-pointer shrink-0">
              <Send size={14} />
            </button>
          </div>
          
          <div className="flex justify-center mt-3 gap-1">
            <Sparkles size={12} className="text-primary opacity-70" />
            <span className="text-[10px] font-mono text-text-dim tracking-widest uppercase">Secured by Sentinel Pipeline</span>
          </div>
        </div>
      </div>
    </div>
  );
}
