import { useRef } from 'react';
import { Round, Course } from '../types';

interface ScoreShareCardProps {
  round: Round;
  course: Course;
  playerName?: string;
  playerScore?: number;
  playerPar?: number;
  playerDiff?: number;
}

export default function ScoreShareCard({
  round,
  course,
  playerName = 'Player',
  playerScore = 0,
  playerPar = 0,
  playerDiff = 0,
}: ScoreShareCardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const generateShareImage = async (): Promise<Blob | null> => {
    if (!canvasRef.current) return null;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Set canvas size (1080x1920 for stories)
    canvas.width = 1080;
    canvas.height = 1920;

    // Load background image
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = '/images/share.png';

    return new Promise((resolve) => {
      img.onload = () => {
        // Draw background
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        // Setup text properties
        ctx.fillStyle = '#010409';
        ctx.textAlign = 'center';
        ctx.font = 'bold 900 72px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.letterSpacing = '-2px';

        // Draw main score (huge, centered in white space)
        ctx.font = 'italic 900 231px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.fillStyle = '#5f8804'; // Dark green
        ctx.fillText(playerScore.toString(), canvas.width / 2, 870);

        // Draw relative to par
        ctx.font = 'italic 700 67px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.fillStyle = playerDiff < 0 ? '#5f8804' : playerDiff > 0 ? '#EF4444' : '#010409';
        const parText = playerDiff < 0 ? `${playerDiff} UNDER PAR` : playerDiff > 0 ? `+${playerDiff} OVER PAR` : 'EVEN PAR';
        ctx.fillText(parText, canvas.width / 2, 970);

        // Draw course name
        ctx.font = 'bold 700 59px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.fillStyle = '#010409';
        ctx.fillText(course.name, canvas.width / 2, 1060);

        // Draw player name and date
        ctx.font = '500 46px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.fillStyle = '#475569'; // Slate
        ctx.fillText(`${playerName} • ${new Date(round.date).toLocaleDateString()}`, canvas.width / 2, 1130);

        // Draw par reference (smaller)
        ctx.font = '500 42px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.fillStyle = '#64748B'; // Lighter slate
        ctx.fillText(`Par ${playerPar}`, canvas.width / 2, 1210);

        // Convert to blob and resolve
        canvas.toBlob((blob) => {
          resolve(blob);
        }, 'image/png', 1);
      };
      img.onerror = () => resolve(null);
    });
  };

  const downloadImage = async () => {
    const blob = await generateShareImage();
    if (!blob) return;

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `street-golf-score-${round.id}.png`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const shareImage = async () => {
    const blob = await generateShareImage();
    if (!blob) return;

    try {
      if (navigator.share) {
        const file = new File([blob], `street-golf-score-${round.id}.png`, {
          type: 'image/png',
        });
        await navigator.share({
          title: 'Street Golf Score',
          text: `Check out my score: ${playerScore} (${playerDiff < 0 ? playerDiff : `+${playerDiff}`}) at ${course.name}!`,
          files: [file],
        });
      } else {
        // Fallback to download if Web Share API not available
        await downloadImage();
      }
    } catch (error) {
      if ((error as any).name !== 'AbortError') {
        console.error('Share failed:', error);
        // Fallback to download on error
        await downloadImage();
      }
    }
  };

  return (
    <div>
      {/* Hidden canvas for generation */}
      <canvas ref={canvasRef} className="hidden" />
      {/* Expose share methods via ref - can be accessed by parent component */}
      <div className="hidden" ref={(el) => {
        if (el) {
          (el as any)._shareImage = shareImage;
          (el as any)._downloadImage = downloadImage;
        }
      }} />
    </div>
  );
}
