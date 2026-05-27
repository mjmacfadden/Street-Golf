import { useEffect, useRef, useState } from 'react';
import { Hole, Round, Player } from '../types';
import { Trophy, Clock, MapPin, ChevronLeft, ChevronRight, Share2 } from 'lucide-react';
import ScoreShareCard from './ScoreShareCard';

interface ScorecardProps {
  round: Round;
  holes: Hole[];
  onFinishRound?: () => void;
  onViewHole?: (holeIndex: number) => void;
}

export default function Scorecard({ round, holes, onFinishRound, onViewHole }: ScorecardProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [activePlayerIdx, setActivePlayerIdx] = useState(round.activePlayerIdx ?? 0);
  const [isSharing, setIsSharing] = useState(false);
  const shareCardRef = useRef<HTMLDivElement>(null);

  // Check if multiplayer
  const isMultiplayer = round.players && round.players.length > 1;

  // Get scores for a specific player or the main scores
  const getScoresForPlayer = (playerIdx: number) => {
    if (round.players && round.players.length > 0) {
      return round.players[playerIdx]?.scores || {};
    }
    return round.scores;
  };

  // Calculate totals for a player
  const calculateTotals = (playerScores: Record<number, any>) => {
    const totalStrokes = Object.values(playerScores).reduce((acc, s: any) => acc + s.strokes, 0);
    const scoredHoles = Object.values(playerScores).length;
    const totalPar = holes.slice(0, scoredHoles).reduce((acc, h) => acc + h.par, 0);
    const diff = totalStrokes - totalPar;
    return { totalStrokes, totalPar, diff, scoredHoles };
  };

  // Get current player's scores (use players array if available, even for single-player)
  const currentPlayerScores = round.players && round.players.length > 0
    ? getScoresForPlayer(activePlayerIdx) 
    : round.scores;
  
  const { totalStrokes, totalPar, diff } = calculateTotals(currentPlayerScores);

  // Auto-scroll to bottom when all holes have scores
  useEffect(() => {
    const allHolesScored = holes.every(hole => currentPlayerScores[hole.number]);
    if (allHolesScored && scrollContainerRef.current) {
      setTimeout(() => {
        scrollContainerRef.current?.scrollTo({ top: scrollContainerRef.current.scrollHeight, behavior: 'smooth' });
      }, 100);
    }
  }, [currentPlayerScores, holes]);

  // Show first player's score when round is completed
  useEffect(() => {
    if (round.isCompleted && activePlayerIdx !== 0) {
      setActivePlayerIdx(0);
    }
  }, [round.isCompleted]);

  const currentPlayer = isMultiplayer ? round.players![activePlayerIdx] : null;

  const handleShareScore = async () => {
    setIsSharing(true);
    try {
      // Generate image from canvas
      await new Promise((resolve) => {
        const canvas = document.createElement('canvas');
        canvas.width = 1080;
        canvas.height = 1920;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = '/images/share.png';

        img.onload = () => {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          ctx.font = 'italic 900 231px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
          ctx.fillStyle = '#5f8804';
          ctx.textAlign = 'center';
          ctx.fillText(totalStrokes.toString(), canvas.width / 2, 870);

          ctx.font = 'italic 700 67px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
          ctx.fillStyle = diff < 0 ? '#5f8804' : diff > 0 ? '#EF4444' : '#010409';
          const parText = diff < 0 ? `${diff} UNDER PAR` : diff > 0 ? `+${diff} OVER PAR` : 'EVEN PAR';
          ctx.fillText(parText, canvas.width / 2, 970);

          ctx.font = 'bold 700 59px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
          ctx.fillStyle = '#010409';
          ctx.fillText(round.courseName || 'Unknown Course', canvas.width / 2, 1060);

          ctx.font = '500 46px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
          ctx.fillStyle = '#475569';
          ctx.fillText(`${round.players?.[activePlayerIdx]?.name || 'Player'} • ${new Date(round.date).toLocaleDateString()}`, canvas.width / 2, 1130);

          ctx.font = '500 42px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
          ctx.fillStyle = '#64748B';
          ctx.fillText(`Par ${totalPar}`, canvas.width / 2, 1210);

          canvas.toBlob((blob) => {
            if (!blob) return;
            if (navigator.share) {
              const file = new File([blob], `street-golf-score-${round.id}.png`, { type: 'image/png' });
              navigator.share({
                title: 'Street Golf Score',
                text: `Check out my score: ${totalStrokes} (${diff < 0 ? diff : `+${diff}`}) at ${round.courseName}!`,
                files: [file],
              }).catch(() => downloadBlob(blob));
            } else {
              downloadBlob(blob);
            }
            resolve(null);
          }, 'image/png', 1);
        };
      });
    } catch (error) {
      console.error('Share failed:', error);
    } finally {
      setIsSharing(false);
    }
  };

  const downloadBlob = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `street-golf-score-${round.id}.png`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div ref={scrollContainerRef} className="p-4 bg-dark min-h-screen text-slate-100 pb-24 overflow-y-auto h-full">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-3xl font-[900] flex items-center gap-3 text-lime uppercase italic tracking-tighter">
          <Trophy size={28} />
          {isMultiplayer ? 'SCORES' : 'SUMMARY'}
        </h2>
        <div className="text-right">
          <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest flex items-center gap-1 justify-end italic">
            <Clock size={12} />
            {new Date(round.date).toLocaleDateString()}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-navy/40 p-4 rounded-2xl border border-white/5 text-center backdrop-blur-sm">
          <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-1 italic">Strokes</p>
          <p className="text-3xl font-[1000] italic leading-none">{totalStrokes || '-'}</p>
        </div>
        <div className="bg-navy/40 p-4 rounded-2xl border border-white/5 text-center backdrop-blur-sm">
          <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-1 italic">Par</p>
          <p className="text-3xl font-[1000] italic leading-none text-white/50">{totalPar || '-'}</p>
        </div>
        <div className="bg-navy/40 p-4 rounded-2xl border border-white/5 text-center backdrop-blur-sm">
          <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-1 italic">Rel</p>
          <p className={`text-3xl font-[1000] italic leading-none ${totalStrokes === 0 ? 'text-slate-400' : diff > 0 ? 'text-red-500' : diff < 0 ? 'text-lime underline' : 'text-slate-100'}`}>
            {totalStrokes === 0 ? '-' : diff > 0 ? `+${diff}` : diff === 0 ? 'E' : diff}
          </p>
        </div>
      </div>

      {/* Player Tabs for Multiplayer - Moved below score cards */}
      {isMultiplayer && round.players && (
        <div className="mb-6">
          <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-3 italic">Active Player</p>
          <div className="flex items-center gap-2 overflow-x-auto pb-2">
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
        </div>
      )}

      <div className="space-y-3">
        {holes.map((hole, idx) => {
          const score = currentPlayerScores[hole.number];
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
        <div className="mt-10 border-t border-white/10 pt-6 space-y-4">
          {/* Share Score Button */}
          <button 
            onClick={handleShareScore}
            disabled={isSharing}
            className="w-full border-2 border-lime text-lime py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-lime/10 transition italic disabled:opacity-50"
          >
            <Share2 size={20} />
            Share Your Score
          </button>

          {/* Finish Round Button */}
          <button 
            onClick={onFinishRound}
            className="w-full bg-lime text-dark py-4 rounded-xl font-black flex items-center justify-center gap-2 shadow-xl shadow-lime/10 italic"
          >
            <Trophy size={20} />
            FINISH ROUND
          </button>
        </div>
      )}
      {/* Hidden ScoreShareCard for reference */}
      <div ref={shareCardRef} className="hidden">
        <ScoreShareCard
          round={round}
          course={{ id: round.courseId || '', name: round.courseName || 'Unknown Course', holes }}
          playerName={round.players?.[activePlayerIdx]?.name || 'Player'}
          playerScore={Object.values(getScoresForPlayer(activePlayerIdx)).reduce((acc: number, s: any) => acc + s.strokes, 0) || 0}
          playerPar={Object.values(getScoresForPlayer(activePlayerIdx)).length > 0 ? holes.slice(0, Object.values(getScoresForPlayer(activePlayerIdx)).length).reduce((acc, h) => acc + h.par, 0) : 0}
          playerDiff={calculateTotals(getScoresForPlayer(activePlayerIdx)).diff}
        />
      </div>
    </div>
  );
}
