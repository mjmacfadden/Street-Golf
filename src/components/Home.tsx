import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Play, Heart, Search, X, MapPin, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import { AuthModal } from './AuthModal';
import { addFavorite, removeFavorite, getUserFavorites } from '../utils/courseService';
import type { Course as FirestoreCourse } from '../utils/courseService';
import type { Course } from '../constants/course';
import { calculateDistance } from '../utils/distance';

interface HomeProps {
  courses: (Course | FirestoreCourse)[];
  onSelectCourse: (course: Course | FirestoreCourse) => void;
  onPlayNow: () => void;
  loading?: boolean;
  currentRound?: Round | null;
  onResumeRound?: () => void;
  onCancelRound?: () => void;
  userLocation?: { lat: number; lng: number } | null;
}

export default function Home({ courses, onSelectCourse, onPlayNow, loading = false, currentRound = null, onResumeRound, onCancelRound, userLocation }: HomeProps) {
  const { currentUser } = useAuth();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [favLoading, setFavLoading] = useState(false);
  const [showFavoriteLoginModal, setShowFavoriteLoginModal] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  // Load user's favorites
  useEffect(() => {
    if (currentUser) {
      getUserFavorites(currentUser.uid).then(favIds => {
        setFavorites(new Set(favIds));
      });
    }
  }, [currentUser]);

  // Reset carousel to first course when courses array changes (e.g., sorted by distance)
  useEffect(() => {
    setCurrentIndex(0);
  }, [courses]);

  // Update selected course whenever carousel changes
  useEffect(() => {
    if (courses[currentIndex]) {
      onSelectCourse(courses[currentIndex]);
    }
  }, [currentIndex, courses]);

  // Filter courses based on search
  const filteredCourses = courses.filter(course => {
    const name = 'courseName' in course ? course.courseName : course.name;
    return name.toLowerCase().includes(searchTerm.toLowerCase());
  });

  const displayCourses = courses;
  const currentCourse = displayCourses[currentIndex];

  const handlePrevious = () => {
    setCurrentIndex((prev) => (prev === 0 ? displayCourses.length - 1 : prev - 1));
  };

  const handleNext = () => {
    setCurrentIndex((prev) => (prev === displayCourses.length - 1 ? 0 : prev + 1));
  };

  const toggleFavorite = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentUser || !currentCourse) {
      if (!currentUser) {
        setShowFavoriteLoginModal(true);
      }
      return;
    }

    const courseId = 'id' in currentCourse ? currentCourse.id : currentCourse.id;
    setFavLoading(true);

    try {
      if (favorites.has(courseId)) {
        await removeFavorite(currentUser.uid, courseId);
        setFavorites(prev => {
          const newSet = new Set(prev);
          newSet.delete(courseId);
          return newSet;
        });
      } else {
        await addFavorite(currentUser.uid, courseId);
        setFavorites(prev => new Set(prev).add(courseId));
      }
    } catch (error) {
      console.error('Failed to toggle favorite:', error);
    } finally {
      setFavLoading(false);
    }
  };

  const getHeaderImage = (course: Course | FirestoreCourse): string => {
    if ('headerImage' in course && course.headerImage) {
      return course.headerImage;
    }
    return '/street-golf/images/golf-course.jpg';
  };

  const getCourseName = (course: Course | FirestoreCourse): string => {
    return 'courseName' in course ? course.courseName : course.name;
  };

  const getCreatorName = (course: Course | FirestoreCourse): string | undefined => {
    if ('creatorName' in course) {
      return course.creatorName;
    }
    return undefined;
  };

  const getHoles = (course: Course | FirestoreCourse): any[] => {
    return course.holes;
  };

  const isFavorited = currentCourse && favorites.has('id' in currentCourse ? currentCourse.id : currentCourse.id);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-dark">
        <div className="text-lime text-xl font-bold">Loading courses...</div>
      </div>
    );
  }

  if (displayCourses.length === 0 && !searchTerm) {
    return (
      <div className="h-full flex items-center justify-center bg-dark flex-col gap-4">
        <div className="text-white text-xl font-bold">No courses found</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-dark">
      {/* Active Round Banner */}
      <AnimatePresence>
        {currentRound && !currentRound.isCompleted && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="bg-gradient-to-r from-lime/20 to-lime/10 border-b border-lime/30 px-6 py-4"
          >
            <div className="max-w-2xl mx-auto flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 flex-1">
                <div className="w-3 h-3 rounded-full bg-lime animate-pulse" />
                <div className="flex-1">
                  <p className="text-lime font-bold text-sm uppercase tracking-tight">Active Round in Progress</p>
                  <p className="text-lime/80 text-xs mt-1">{currentRound.courseName || 'Unknown Course'}</p>
                </div>
              </div>
              <div className="flex flex-col items-stretch gap-1 w-32">
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={onResumeRound}
                  className="bg-lime text-dark px-3 py-1.5 rounded-lg font-bold text-xs flex items-center justify-center gap-1 hover:bg-lime/90 transition whitespace-nowrap"
                >
                  <MapPin size={14} />
                  Resume
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setShowCancelConfirm(true)}
                  className="bg-red-500/20 text-red-400 px-3 py-1.5 rounded-lg font-bold text-xs hover:bg-red-500/30 transition whitespace-nowrap border border-red-500/30"
                >
                  Cancel
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Favorite Login Modal */}
      <AnimatePresence>
        {showFavoriteLoginModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowFavoriteLoginModal(false)}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-dark rounded-2xl p-8 max-w-sm w-full mx-4 border border-white/10"
            >
              <div className="text-center">
                <div className="inline-block p-3 bg-red-500/20 rounded-full mb-4">
                  <Heart className="w-6 h-6 text-red-500" />
                </div>
                <h2 className="text-2xl font-black text-white mb-2">
                  Create an Account
                </h2>
                <p className="text-white/60 mb-6">
                  Sign in to save your favorite courses and access them anytime
                </p>
                <AuthModal onClose={() => setShowFavoriteLoginModal(false)} />
                <button
                  onClick={() => setShowFavoriteLoginModal(false)}
                  className="w-full px-4 py-3 mt-3 bg-white/10 text-white font-bold rounded-lg hover:bg-white/20 transition"
                >
                  Maybe Later
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Search Results Modal */}
      <AnimatePresence>
        {showSearchResults && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowSearchResults(false)}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-dark rounded-2xl border border-white/10 max-w-md w-full max-h-[80vh] flex flex-col"
            >
              {/* Header */}
              <div className="flex items-center justify-between p-6 border-b border-white/10">
                <h2 className="text-xl font-black text-white uppercase italic">
                  Search Results
                </h2>
                <button
                  onClick={() => setShowSearchResults(false)}
                  className="p-1 hover:bg-white/20 rounded-lg transition"
                >
                  <X size={20} className="text-white" />
                </button>
              </div>

              {/* Results List */}
              <div className="flex-1 overflow-y-auto">
                {filteredCourses.length === 0 ? (
                  <div className="p-6 text-center text-white/60">
                    No courses found matching "{searchTerm}"
                  </div>
                ) : (
                  <div className="p-4 space-y-2">
                    {filteredCourses.map((course, idx) => (
                      <motion.button
                        key={idx}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.05 }}
                        onClick={() => {
                          setCurrentIndex(courses.indexOf(course));
                          setShowSearchResults(false);
                          setSearchTerm('');
                          onSelectCourse(course);
                        }}
                        className="w-full text-left p-4 rounded-lg bg-slate-900/50 hover:bg-lime/20 border border-slate-700 hover:border-lime/50 transition group"
                      >
                        <h3 className="font-bold text-white group-hover:text-lime transition">
                          {'courseName' in course ? course.courseName : course.name}
                        </h3>
                        <div className="flex gap-4 mt-1 text-xs text-white/60 group-hover:text-white/80">
                          <span>{course.holes.length} holes</span>
                          {'creatorName' in course && course.creatorName && (
                            <span>By: {course.creatorName}</span>
                          )}
                          {'location' in course && course.location && (
                            <span>{course.location}</span>
                          )}
                        </div>
                      </motion.button>
                    ))}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="border-t border-white/10 p-4 bg-slate-900/30">
                <p className="text-xs text-white/60 text-center">
                  Click a course to view
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Course Carousel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 relative bg-black">
          {/* Search Bar - Positioned over carousel */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute top-4 left-0 right-0 z-20 p-4"
          >
            <div className="flex items-center gap-2 max-w-2xl mx-auto">
              <motion.div
                animate={{ width: searchOpen ? '100%' : 'auto' }}
                className="flex items-center gap-2 flex-1"
              >
                {searchOpen && (
                  <input
                    autoFocus
                    type="text"
                    value={searchTerm}
                    onChange={(e) => {
                      setSearchTerm(e.target.value);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        setShowSearchResults(true);
                        setSearchOpen(false);
                      }
                      if (e.key === 'Escape') {
                        setSearchOpen(false);
                        setSearchTerm('');
                      }
                    }}
                    placeholder="Search courses..."
                    className="flex-1 px-4 py-2 bg-black/40 border border-white/30 rounded-lg text-white placeholder-white/60 focus:outline-none focus:border-lime/50 focus:bg-black/50"
                  />
                )}
              </motion.div>

              {searchOpen ? (
                <button
                  onClick={() => {
                    setSearchOpen(false);
                    setSearchTerm('');
                  }}
                  className="p-2 hover:bg-white/20 rounded-lg text-white transition"
                  title="Close search"
                >
                  <X size={20} />
                </button>
              ) : (
                <button
                  onClick={() => setSearchOpen(true)}
                  className="p-2 hover:bg-white/20 rounded-lg text-white transition"
                  title="Search courses"
                >
                  <Search size={20} />
                </button>
              )}
            </div>
          </motion.div>

          <AnimatePresence mode="wait">
            {currentCourse && (
              <motion.div
                key={`course-${currentIndex}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="absolute inset-0"
              >
                {/* Header Image */}
                <img
                  src={getHeaderImage(currentCourse)}
                  alt={getCourseName(currentCourse)}
                  className="w-full h-full object-cover"
                />

                {/* Gradient Overlay */}
                <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/80" />

                {/* Play Now Button */}
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.2 }}
                  className="absolute inset-0 flex items-center justify-center pointer-events-none"
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectCourse(currentCourse);
                      onPlayNow();
                    }}
                    className="flex flex-col items-center gap-3 bg-black/40 hover:bg-black/60 rounded-full p-6 transition backdrop-blur-sm cursor-pointer z-10 pointer-events-auto"
                  >
                    <Play size={48} className="text-lime fill-lime" />
                    <span className="text-white font-bold text-lg">Play Now</span>
                  </button>
                </motion.div>

                {/* Navigation Arrows */}
                {displayCourses.length > 1 && (
                  <>
                    <button
                      onClick={handlePrevious}
                      className="absolute left-4 top-1/2 -translate-y-1/2 z-10 p-2 bg-white/20 hover:bg-white/40 rounded-lg backdrop-blur-sm transition"
                    >
                      <ChevronLeft size={28} className="text-white" />
                    </button>
                    <button
                      onClick={handleNext}
                      className="absolute right-4 top-1/2 -translate-y-1/2 z-10 p-2 bg-white/20 hover:bg-white/40 rounded-lg backdrop-blur-sm transition"
                    >
                      <ChevronRight size={28} className="text-white" />
                    </button>
                  </>
                )}

              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Course Information */}
        <div 
          className="flex-1 overflow-y-auto bg-white p-6 scrollbar-transparent" 
          style={{ 
            scrollbarGutter: 'stable',
            scrollbarColor: 'rgba(180, 180, 180, 0.5) transparent'
          }}
        >
          <style>{`
            .scrollbar-transparent::-webkit-scrollbar {
              width: 8px;
            }
            .scrollbar-transparent::-webkit-scrollbar-track {
              background: transparent;
            }
            .scrollbar-transparent::-webkit-scrollbar-thumb {
              background: rgba(180, 180, 180, 0.5);
              border-radius: 4px;
            }
            .scrollbar-transparent::-webkit-scrollbar-thumb:hover {
              background: rgba(160, 160, 160, 0.7);
            }
          `}</style>
          <div className="space-y-4">
            {currentCourse && (
              <>
                {/* Header with Name and Favorite */}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <h2 className="text-2xl font-bold text-dark">{getCourseName(currentCourse)}</h2>
                    <div className="flex items-center gap-2 mt-2">
                      {getCreatorName(currentCourse) && (
                        <p className="text-dark/60 text-sm">By: {getCreatorName(currentCourse)}</p>
                      )}
                      {userLocation && currentCourse.holes && currentCourse.holes[0]?.teeLocation && (
                        <div className="inline-flex items-center gap-1 text-sm text-slate-400 font-bold">
                          <MapPin size={14} />
                          {calculateDistance(
                            userLocation.lat,
                            userLocation.lng,
                            currentCourse.holes[0].teeLocation.lat,
                            currentCourse.holes[0].teeLocation.lng
                          ).toFixed(1)}{' '}
                          mi
                        </div>
                      )}
                    </div>
                  </div>

                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={toggleFavorite}
                    disabled={favLoading}
                    className="flex-shrink-0 p-2 hover:bg-gray-100 rounded-lg transition disabled:cursor-not-allowed"
                    title={'Add to favorites'}
                  >
                    <Heart
                      size={28}
                      className={`transition ${
                        isFavorited ? 'text-red-500 fill-red-500' : 'text-dark/40'
                      }`}
                    />
                  </motion.button>
                </div>

                {/* Holes List */}
                <div>
                  <h3 className="text-sm font-bold text-dark/70 uppercase tracking-wider mb-3">
                    Holes ({getHoles(currentCourse).length})
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full">
                    {getHoles(currentCourse).map((hole, idx) => (
                      <div
                        key={`${hole.id || idx}`}
                        className="p-3 bg-gray-50 rounded-lg border border-gray-200"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-dark">
                            {typeof hole.number !== 'undefined' ? hole.number : idx + 1}
                          </span>
                          <span className="text-sm text-dark/60">Par {hole.par}</span>
                        </div>
                        <p className="text-sm text-dark/70 truncate mt-1">{hole.name}</p>
                        {hole.hazard && (
                          <div className="text-xs text-orange-600 font-bold mt-1">⚠ Hazard</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Cancel Round Confirmation Modal */}
        <AnimatePresence>
          {showCancelConfirm && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowCancelConfirm(false)}
              className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-dark border border-red-500/30 rounded-2xl p-6 max-w-sm w-full"
              >
                <div className="flex items-start gap-4 mb-4">
                  <div className="p-2 bg-red-500/20 rounded-lg text-red-400">
                    <AlertTriangle size={20} />
                  </div>
                  <div>
                    <h3 className="font-black text-white mb-1 uppercase italic">Cancel Round?</h3>
                    <p className="text-sm text-slate-400">
                      All progress on this round will be lost. This cannot be undone.
                    </p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowCancelConfirm(false)}
                    className="flex-1 px-4 py-2 bg-white/10 rounded-lg text-white font-bold hover:bg-white/20 transition-colors"
                  >
                    Keep Playing
                  </button>
                  <button
                    onClick={() => {
                      onCancelRound?.();
                      setShowCancelConfirm(false);
                    }}
                    className="flex-1 px-4 py-2 bg-red-500 rounded-lg text-white font-bold hover:bg-red-600 transition-colors"
                  >
                    Cancel Round
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
