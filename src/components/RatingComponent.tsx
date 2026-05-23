import { useState, useEffect } from 'react';
import { Star } from 'lucide-react';
import { rateCourse, getUserCourseRating, getCourseRatings } from '../utils/courseService';
import { useAuth } from '../context/AuthContext';

interface RatingComponentProps {
  courseId: string;
  averageRating: number;
  totalRatings: number;
  onRatingSubmitted?: (newRating: number) => void;
}

export function RatingComponent({
  courseId,
  averageRating: initialAverageRating,
  totalRatings: initialTotalRatings,
  onRatingSubmitted,
}: RatingComponentProps) {
  const { currentUser } = useAuth();
  const [userRating, setUserRating] = useState<number | undefined>(undefined);
  const [averageRating, setAverageRating] = useState(initialAverageRating);
  const [totalRatings, setTotalRatings] = useState(initialTotalRatings);
  const [hoverRating, setHoverRating] = useState<number | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadingRating, setLoadingRating] = useState(true);

  // Load user's current rating and initial ratings when component mounts
  useEffect(() => {
    const loadData = async () => {
      if (!currentUser) {
        setLoadingRating(false);
        return;
      }

      try {
        const rating = await getUserCourseRating(courseId, currentUser.uid);
        setUserRating(rating);
        
        // Also load current ratings
        const ratingsData = await getCourseRatings(courseId);
        setAverageRating(ratingsData.averageRating);
        setTotalRatings(ratingsData.totalRatings);
      } catch (error) {
        console.warn('Failed to load rating data:', error);
      } finally {
        setLoadingRating(false);
      }
    };

    loadData();
  }, [courseId, currentUser]);

  const handleStarClick = async (rating: number) => {
    if (!currentUser || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await rateCourse(courseId, currentUser.uid, rating);
      setUserRating(rating);
      
      // Fetch updated ratings after vote
      const ratingsData = await getCourseRatings(courseId);
      setAverageRating(ratingsData.averageRating);
      setTotalRatings(ratingsData.totalRatings);
      
      onRatingSubmitted?.(rating);
      console.log(`✅ Rated course ${rating} stars`);
    } catch (error) {
      console.error('Failed to submit rating:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Round average rating to nearest 0.5
  const roundedRating = Math.round(averageRating * 2) / 2;

  // Render filled, half, and empty stars
  const renderStars = (rating: number) => {
    const stars = [];
    for (let i = 1; i <= 5; i++) {
      if (rating >= i) {
        // Fully filled star
        stars.push(
          <Star
            key={i}
            size={16}
            className="fill-yellow-400 text-yellow-400"
          />
        );
      } else if (rating >= i - 0.5) {
        // Half-filled star
        stars.push(
          <div key={i} className="relative w-4 h-4">
            <Star size={16} className="text-slate-400" />
            <div className="absolute left-0 top-0 overflow-hidden w-2">
              <Star size={16} className="fill-yellow-400 text-yellow-400" />
            </div>
          </div>
        );
      } else {
        // Empty star
        stars.push(
          <Star key={i} size={16} className="text-slate-400" />
        );
      }
    }
    return stars;
  };

  const displayRating = hoverRating ?? userRating;

  return (
    <div className="flex items-center gap-3">
      {/* Average Rating */}
      <span className="text-sm font-bold text-slate-200 min-w-[32px]">
        {averageRating > 0 ? averageRating.toFixed(1) : '—'}
      </span>

      {/* Stars - Interactive if logged in, display-only otherwise */}
      <div className="flex gap-1">
        {currentUser && !loadingRating ? (
          <div
            className="flex gap-0.5 cursor-pointer"
            onMouseLeave={() => setHoverRating(undefined)}
          >
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                onMouseEnter={() => setHoverRating(star)}
                onClick={() => handleStarClick(star)}
                disabled={isSubmitting}
                className="transition-opacity hover:opacity-80 disabled:opacity-50"
                title={`Rate ${star} star${star !== 1 ? 's' : ''}`}
              >
                <Star
                  size={16}
                  className={
                    (displayRating ?? 0) >= star
                      ? 'fill-yellow-400 text-yellow-400'
                      : 'text-slate-400'
                  }
                />
              </button>
            ))}
          </div>
        ) : (
          // Display-only stars for guests
          <div className="flex gap-0.5">
            {renderStars(roundedRating)}
          </div>
        )}
      </div>

      {/* Vote Count */}
      <span className="text-xs text-slate-500 ml-2">
        ({totalRatings} {totalRatings === 1 ? 'vote' : 'votes'})
      </span>
    </div>
  );
}
