import { useEffect, useRef } from 'react';
import { Hole, Round } from '../types';
import { Trophy, Clock, MapPin } from 'lucide-react';

interface ScorecardProps {
  round: Round;
  holes: Hole[];
  onFinishRound?: () => void;
  onViewHole?: (holeIndex: number) => void;
}

export default function Scorecard({ round, holes, onFinishRound, onViewHole }: ScorecardProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when all holes have scores
  useEffect(() => {
    const allHolesScored = holes.every(hole => round.scores[hole.number]);
    if (allHolesScored && scrollContainerRef.current) {
      setTimeout(() => {
        scrollContainerRef.current?.scrollTo({ top: scrollContainerRef.current.scrollHeight, behavior: 'smooth' });
      }, 100);
    }
  }, [round.scores, holes]);

  const totalPar = holes.reduce((acc, h) => acc + h.par, 0);
  const totalStrokes = Object.values(round.scores).reduce((acc, s) => acc + s.strokes, 0);
  const diff = totalStrokes - holes.filter(h => round.scores[h.number]).reduce((acc, h) => acc + h.par, 0);

  return (
    <div ref={scrollContainerRef} className="p-4 bg-dark min-h-screen text-slate-100 pb-24 overflow-y-auto h-full">
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-3xl font-[900] flex items-center gap-3 text-lime uppercase italic tracking-tighter">
          <Trophy size={28} />
          SUMMARY
        </h2>
        <div className="text-right">
          <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest flex items-center gap-1 justify-end italic">
            <Clock size={12} />
            {new Date(round.date).toLocaleDateString()}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-10">
        <div className="bg-navy/40 p-4 rounded-2xl border border-white/5 text-center backdrop-blur-sm">
          <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-1 italic">Strokes</p>
          <p className="text-3xl font-[1000] italic leading-none">{totalStrokes}</p>
        </div>
        <div className="bg-navy/40 p-4 rounded-2xl border border-white/5 text-center backdrop-blur-sm">
          <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-1 italic">Par</p>
          <p className="text-3xl font-[1000] italic leading-none text-white/50">{totalPar}</p>
        </div>
        <div className="bg-navy/40 p-4 rounded-2xl border border-white/5 text-center backdrop-blur-sm">
          <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-1 italic">Rel</p>
          <p className={`text-3xl font-[1000] italic leading-none ${diff > 0 ? 'text-red-500' : diff < 0 ? 'text-lime underline' : 'text-slate-100'}`}>
            {diff > 0 ? `+${diff}` : diff === 0 ? 'E' : diff}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {holes.map((hole, idx) => {
          const score = round.scores[hole.number];
          return (
            <div 
              key={hole.number}
              onClick={() => onViewHole?.(idx)}
              className={`flex items-center justify-between p-4 bg-navy/20 rounded-2xl border border-white/5 hover:border-lime/20 transition-all group ${onViewHole ? 'cursor-pointer hover:bg-navy/40' : ''}`}
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-navy flex items-center justify-center text-sm font-black italic border border-white/5 group-hover:bg-lime group-hover:text-dark transition-colors">
                  {hole.number}
                </div>
                <div className="flex-1">
                  <p className="font-black italic uppercase text-sm tracking-tight">{hole.name}</p>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Par {hole.par}</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                {score ? (
                  <p className={`text-2xl font-[1000] italic ${score.strokes < hole.par ? 'text-lime' : score.strokes > hole.par ? 'text-red-500' : ''}`}>
                    {score.strokes}
                  </p>
                ) : (
                  <p className="text-white/10 font-bold">-</p>
                )}
                {onViewHole && (
                  <MapPin size={16} className="text-lime/40 group-hover:text-lime transition-colors" />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {onFinishRound && (
        <div className="mt-10 border-t border-white/10">
          <button 
            onClick={onFinishRound}
            className="w-full bg-lime text-dark py-4 rounded-xl font-black flex items-center justify-center gap-2 shadow-xl shadow-lime/10 italic"
          >
            <Trophy size={20} />
            FINISH ROUND
          </button>
        </div>
      )}
    </div>
  );
}
