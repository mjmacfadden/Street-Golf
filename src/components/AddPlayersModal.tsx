import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Trash2, ChevronRight } from 'lucide-react';
import { useState } from 'react';

interface AddPlayersModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStart: (playerNames: string[]) => void;
  defaultPlayerName?: string;
}

export default function AddPlayersModal({ isOpen, onClose, onStart, defaultPlayerName = 'Player 1' }: AddPlayersModalProps) {
  const [players, setPlayers] = useState<string[]>([defaultPlayerName]);
  const [newPlayerInput, setNewPlayerInput] = useState('');

  const addPlayer = () => {
    if (newPlayerInput.trim()) {
      setPlayers([...players, newPlayerInput.trim()]);
      setNewPlayerInput('');
    }
  };

  const removePlayer = (index: number) => {
    if (players.length > 1) {
      setPlayers(players.filter((_, i) => i !== index));
    }
  };

  const updatePlayerName = (index: number, name: string) => {
    const updated = [...players];
    updated[index] = name;
    setPlayers(updated);
  };

  const handleStart = () => {
    if (players.length > 0 && players.every(p => p.trim())) {
      onStart(players);
      setPlayers([defaultPlayerName]);
      setNewPlayerInput('');
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-navy/80 rounded-3xl p-6 border border-slate-700 backdrop-blur-sm"
          >
            <h2 className="text-2xl font-black text-lime uppercase italic tracking-tight mb-6">
              Who's Playing?
            </h2>

            <div className="space-y-3 mb-6 max-h-64 overflow-y-auto">
              {players.map((player, idx) => (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="flex gap-2 items-center"
                >
                  <div className="w-8 h-8 rounded-full bg-lime/20 text-lime flex items-center justify-center font-black text-sm flex-shrink-0">
                    {idx + 1}
                  </div>
                  <input
                    type="text"
                    value={player}
                    onChange={(e) => updatePlayerName(idx, e.target.value)}
                    maxLength={20}
                    className="flex-1 bg-slate-950/50 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-lime/50 text-sm"
                    placeholder="Player name"
                  />
                  <button
                    onClick={() => removePlayer(idx)}
                    disabled={players.length === 1}
                    className="p-2 text-red-400 hover:bg-red-500/20 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <Trash2 size={18} />
                  </button>
                </motion.div>
              ))}
            </div>

            {/* Add Player Input */}
            <div className="flex gap-2 mb-6">
              <input
                type="text"
                value={newPlayerInput}
                onChange={(e) => setNewPlayerInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && addPlayer()}
                maxLength={20}
                placeholder="Add another player..."
                className="flex-1 bg-slate-950/50 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-lime/50 text-sm"
              />
              <button
                onClick={addPlayer}
                disabled={!newPlayerInput.trim()}
                className="bg-lime/20 hover:bg-lime/30 text-lime px-3 py-2 rounded-lg disabled:opacity-30 transition-colors font-bold"
              >
                <Plus size={18} />
              </button>
            </div>

            {/* Player Count */}
            <div className="text-xs text-slate-400 mb-6 text-center">
              {players.length} {players.length === 1 ? 'player' : 'players'} ready
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2 bg-white/10 rounded-lg text-white font-bold hover:bg-white/20 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleStart}
                disabled={players.length === 0 || !players.every(p => p.trim())}
                className="flex-1 px-4 py-2 bg-lime text-dark rounded-lg font-bold hover:bg-lime/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                Start Round
                <ChevronRight size={18} />
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
