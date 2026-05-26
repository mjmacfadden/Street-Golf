import { useState } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { Round, Course } from '../types';

interface RoundDetailModalProps {
  round: Round;
  courses: Course[];
  onClose: () => void;
}

export default function RoundDetailModal({ round, courses, onClose }: RoundDetailModalProps) {
  const [activePlayerIdx, setActivePlayerIdx] = useState(0);

  // Check if multiplayer
  const isMultiplayer = round.players && round.players.length > 1;

  // Get scores for the active player (use players array if available, even for single-player)
  const getScoresForPlayer = () => {
    if (round.players && round.players.length > 0) {
      return round.players[activePlayerIdx]?.scores || {};
    }
    return round.scores;
  };

  const currentScores = getScoresForPlayer();
  const roundCourse = courses.find(c => c.id === round.courseId) || courses[0];
  const holes = (roundCourse.holes || []).filter((hole): hole is typeof roundCourse.holes[0] => hole !== null && hole !== undefined);
  
  // Calculate totals
  const totalStrokes = Object.values(currentScores).reduce((acc, s: any) => acc + s.strokes, 0);
  const scoredHoles = Object.values(currentScores).length;
  const totalPar = holes.slice(0, scoredHoles).reduce((acc, h) => acc + h.par, 0);
  const diff = totalStrokes - totalPar;
  
  const currentPlayer = isMultiplayer ? round.players?.[activePlayerIdx] : null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-xl flex items-center justify-center p-6"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-navy/80 rounded-3xl overflow-hidden shadow-2xl border border-slate-700 max-h-[80vh] overflow-y-auto"
      >
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-2xl font-black text-lime uppercase italic tracking-tight">Round Details</h3>
              <p className="text-xs text-slate-400 mt-1">{new Date(round.date).toLocaleDateString()}</p>
              {round.courseName && (
                <p className="text-xs text-slate-500 mt-1">{round.courseName}</p>
              )}
            </div>
            <button 
              onClick={onClose}
              className="p-2 hover:bg-white/10 rounded-lg"
            >
              <X size={20} />
            </button>
          </div>

          {/* Player Tabs for Multiplayer */}
          {isMultiplayer && round.players && (
            <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-2">
              <button 
                onClick={() => setActivePlayerIdx(Math.max(0, activePlayerIdx - 1))}
                disabled={activePlayerIdx === 0}
                className="p-2 text-slate-400 hover:text-white disabled:opacity-30 flex-shrink-0"
              >
                <ChevronLeft size={20} />
              </button>
              {round.players.map((player, idx) => (
                <button
                  key={player.id}
                  onClick={() => setActivePlayerIdx(idx)}
                  className={`px-4 py-2 rounded-lg font-bold uppercase text-sm tracking-tight whitespace-nowrap transition-colors flex-shrink-0 ${
                    idx === activePlayerIdx
                      ? 'bg-lime text-dark'
                      : 'bg-navy/40 text-slate-300 hover:bg-navy/60'
                  }`}
                >
                  {player.name}
                </button>
              ))}
              <button 
                onClick={() => setActivePlayerIdx(Math.min(round.players!.length - 1, activePlayerIdx + 1))}
                disabled={activePlayerIdx === round.players.length - 1}
                className="p-2 text-slate-400 hover:text-white disabled:opacity-30 flex-shrink-0"
              >
                <ChevronRight size={20} />
              </button>
            </div>
          )}

          {isMultiplayer && currentPlayer && (
            <div className="mb-4 text-center">
              <p className="text-sm text-slate-400 uppercase font-bold tracking-wider italic">
                Viewing: <span className="text-lime">{currentPlayer.name}</span>
              </p>
            </div>
          )}

          <div className="space-y-3">
            {holes.map((hole) => {
              const score = currentScores[hole.number];
              return (
                <div 
                  key={hole.number}
                  className="flex items-center justify-between p-3 bg-slate-950/50 rounded-xl border border-white/5"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-lime text-dark flex items-center justify-center text-xs font-black italic">
                      {hole.number}
                    </div>
                    <div>
                      <p className="font-bold text-sm">{hole.name}</p>
                      <p className="text-[10px] text-slate-500">Par {hole.par}</p>
                    </div>
                  </div>
                  {score ? (
                    <p className={`text-lg font-[1000] italic ${score.strokes < hole.par ? 'text-lime' : score.strokes > hole.par ? 'text-red-500' : ''}`}>
                      {score.strokes}
                    </p>
                  ) : (
                    <p className="text-slate-600 font-bold">-</p>
                  )}
                </div>
              );
            })}
          </div>

          {/* Score Summary */}
          <div className="mt-6 pt-6 border-t border-white/10">
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-slate-950/50 p-3 rounded-xl border border-white/5 text-center">
                <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-1 italic">Strokes</p>
                <p className="text-2xl font-[1000] italic leading-none">{totalStrokes || '-'}</p>
              </div>
              <div className="bg-slate-950/50 p-3 rounded-xl border border-white/5 text-center">
                <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-1 italic">Par</p>
                <p className="text-2xl font-[1000] italic leading-none text-white/50">{totalPar || '-'}</p>
              </div>
              <div className="bg-slate-950/50 p-3 rounded-xl border border-white/5 text-center">
                <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-1 italic">Rel</p>
                <p className={`text-2xl font-[1000] italic leading-none ${totalStrokes === 0 ? 'text-slate-400' : diff > 0 ? 'text-red-500' : diff < 0 ? 'text-lime underline' : 'text-slate-100'}`}>
                  {totalStrokes === 0 ? '-' : diff > 0 ? `+${diff}` : diff === 0 ? 'E' : diff}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
