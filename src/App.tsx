import { useState, useEffect, ReactNode } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import { Map as MapIcon, List as ListIcon, History as HistoryIcon, Play, ChevronLeft, ChevronRight, Pencil, Flag, Trophy, Image as ImageIcon, X, Home, Info, AlertTriangle, Hammer, LogOut, User, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import MapView from './components/MapView';
import Scorecard from './components/Scorecard';
import CourseBuilder from './components/CourseBuilder';
import { Profile } from './components/Profile';
import HomeComponent from './components/Home';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AuthModal } from './components/AuthModal';
import { getPublishedCourses, getUserCourses, saveRound, getUserRounds, deleteRound as deleteRoundFromFirestore } from './utils/courseService';
import { captureGPSLocation } from './utils/geolocation';
import type { Course as FirestoreCourse } from './utils/courseService';
import { STREET_GOLF_COURSE, COURSES, type Course } from './constants/course';
import { Round, Score } from './types';
import { getImagePath } from './utils/paths';

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_PLATFORM_KEY || '';
const hasValidKey = Boolean(API_KEY) && API_KEY !== 'YOUR_API_KEY' && API_KEY !== 'MY_MAPS_KEY';

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

function AppContent() {
  const { currentUser, loading } = useAuth();
  const [activeTab, setActiveTab] = useState<'home' | 'map' | 'scorecard' | 'history' | 'builder' | 'profile'>('home');
  const [showAuthModal, setShowAuthModal] = useState(() => {
    // Auto-open auth modal if redirected from PWA's "Open in Browser" fallback
    return new URLSearchParams(window.location.search).get('openAuth') === '1';
  });
  
  // Courses
  const [availableCourses, setAvailableCourses] = useState<Course[]>(COURSES);
  const [coursesLoading, setCoursesLoading] = useState(true);
  const [coursesError, setCoursesError] = useState<string | null>(null);
  const [selectedCourse, setSelectedCourse] = useState<Course>(COURSES[0]);
  
  // Geolocation
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);

  const currentCourseHoles = selectedCourse.holes;
  const [currentHoleIdx, setCurrentHoleIdx] = useState<number | null>(null);
  const [isCardCollapsed, setIsCardCollapsed] = useState(false);
  const [currentRound, setCurrentRound] = useState<Round | null>(null);
  const [history, setHistory] = useState<Round[]>([]);
  const [tempScore, setTempScore] = useState<number>(4);
  const [lightboxImage, setLightboxImage] = useState<{ url: string; title: string } | null>(null);
  const [showTip, setShowTip] = useState(false);
  const [selectedHistoryRound, setSelectedHistoryRound] = useState<Round | null>(null);
  const [deleteConfirmRound, setDeleteConfirmRound] = useState<string | null>(null);
  const [editingCourse, setEditingCourse] = useState<FirestoreCourse | null>(null);
  const [courseRefreshTrigger, setCourseRefreshTrigger] = useState(0);

  // Convert Firestore course to local Course format
  const convertFirestoreCourse = (fsCourse: FirestoreCourse): Course => {
    return {
      id: fsCourse.id,
      name: fsCourse.courseName,
      location: 'User Created Course',
      headerImage: fsCourse.headerImage || null,
      holes: fsCourse.holes.map((hole, idx) => ({
        number: idx + 1,
        name: hole.name,
        teeLocation: hole.teeLocation,
        teeDescription: hole.teeDescription,
        teeImage: hole.teeImage || undefined,
        pinLocation: hole.pinLocation,
        pinDescription: hole.pinDescription,
        pinImage: hole.pinImage || undefined,
        par: hole.par,
        tip: hole.tip,
        hazard: hole.hazard,
      })),
    };
  };

  // Fetch courses from Firestore
  useEffect(() => {
    const fetchCourses = async () => {
      try {
        const startTime = performance.now();
        setCoursesLoading(true);
        setCoursesError(null);
        console.log('🔄 Starting course fetch...');

        // Start with default courses
        let courses: Course[] = COURSES;

        // Fetch published courses with timeout
        try {
          console.log('🔄 Fetching published courses...');
          const publishedPromise = getPublishedCourses();
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Published courses fetch timeout')), 5000)
          );
          
          const publishedCourses = await Promise.race([publishedPromise, timeoutPromise]);
          const converted = publishedCourses.map(convertFirestoreCourse);
          courses = [...COURSES, ...converted];
          console.log(`✅ Loaded ${converted.length} published courses in ${performance.now() - startTime}ms`);
        } catch (err) {
          console.warn('⚠️ Failed to fetch published courses (this is optional):', err);
          // Published courses are optional, don't fail if they don't load
        }

        // Fetch user's own courses (if signed in) with timeout
        if (currentUser) {
          try {
            console.log('🔄 Fetching user courses for:', currentUser.email);
            const userPromise = getUserCourses(currentUser.uid);
            const timeoutPromise = new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('User courses fetch timeout')), 5000)
            );
            
            const userCourses = await Promise.race([userPromise, timeoutPromise]);
            const converted = userCourses.map(convertFirestoreCourse);
            courses = [
              ...COURSES,
              ...converted,
            ];
            console.log(`✅ Loaded ${converted.length} user courses in ${performance.now() - startTime}ms`);
          } catch (err) {
            console.warn('⚠️ Failed to fetch user courses:', err);
            // User courses optional too
          }
        }

        setAvailableCourses(courses);
        console.log(`✅ Course fetch completed in ${performance.now() - startTime}ms. Total courses: ${courses.length}`);
      } catch (error) {
        console.error('❌ Error fetching courses:', error);
        setCoursesError('Failed to load courses');
        // Keep default courses available
        setAvailableCourses(COURSES);
      } finally {
        setCoursesLoading(false);
      }
    };

    // Only fetch if we've finished loading auth state
    if (!loading) {
      fetchCourses();
    }
  }, [currentUser, loading, courseRefreshTrigger]);

  // Capture user location when map view is opened and no round is active
  useEffect(() => {
    console.log('Geolocation effect check:', { activeTab, currentHoleIdx, hasUserLocation: !!userLocation });
    
    if (activeTab === 'map' && currentHoleIdx === null && !userLocation) {
      console.log('Conditions met - starting geolocation capture...');
      const captureLocation = async () => {
        try {
          setLocationError(null);
          const location = await captureGPSLocation(10000, 10);
          console.log('✅ Location captured successfully:', location);
          setUserLocation(location);
        } catch (error: any) {
          console.warn('❌ Failed to capture location:', error);
          setLocationError(error.message || 'Could not get your location');
        }
      };

      captureLocation();
    } else {
      console.log('Conditions not met for geolocation capture');
    }
  }, [activeTab, currentHoleIdx, userLocation]);

  // Clear user location when a round is started
  useEffect(() => {
    if (currentHoleIdx !== null) {
      setUserLocation(null);
      setLocationError(null);
    }
  }, [currentHoleIdx]);

  // Ensure selectedCourse is valid when availableCourses changes
  useEffect(() => {
    if (!availableCourses.find(c => c.id === selectedCourse.id)) {
      setSelectedCourse(availableCourses[0] || COURSES[0]);
    }
  }, [availableCourses]);

  // Load persistence (Firestore for logged-in users, localStorage for guests only)
  useEffect(() => {
    const loadData = async () => {
      const ensureCourseName = (round: Round) => {
        if (round.courseName) return round;
        // Only use COURSES for lookups to avoid overwriting with stale availableCourses
        const course = COURSES.find(c => c.id === round.courseId);
        return { ...round, courseName: course?.name || 'Unknown Course' };
      };

      if (currentUser?.uid) {
        try {
          const userRounds = await getUserRounds(currentUser.uid);
          // Migrate Firestore rounds to ensure they have courseName
          const migratedRounds = userRounds.map(ensureCourseName);
          setHistory(migratedRounds);
        } catch (error) {
          console.error('Failed to load rounds from Firestore:', error);
          // For logged-in users, do NOT fall back to localStorage
          setHistory([]);
        }
      } else {
        // Guest user - load from localStorage only
        const savedRound = localStorage.getItem('currentRound');
        const savedHistory = localStorage.getItem('roundHistory');
        
        if (savedRound) {
          const round = ensureCourseName(JSON.parse(savedRound));
          setCurrentRound(round);
        }
        if (savedHistory) {
          const rounds = JSON.parse(savedHistory);
          const migratedRounds = rounds.map(ensureCourseName);
          setHistory(migratedRounds);
        }
      }
    };

    if (!loading) {
      loadData();
    }
  }, [currentUser, loading]);

  // Save persistence (Firestore for logged-in users, localStorage for guests)
  useEffect(() => {
    const saveData = async () => {
      if (currentUser?.uid) {
        // Save to Firestore for logged-in users
        if (currentRound) {
          try {
            // Ensure courseName is always present before saving
            const roundToSave = {
              ...currentRound,
              courseName: currentRound.courseName || availableCourses.find(c => c.id === currentRound.courseId)?.name || 'Unknown Course'
            };
            await saveRound(currentUser.uid, roundToSave);
          } catch (error) {
            console.error('Failed to save current round:', error);
          }
        }
        if (history.length > 0) {
          // Save each round to Firestore
          for (const round of history) {
            try {
              const roundToSave = {
                ...round,
                courseName: round.courseName || availableCourses.find(c => c.id === round.courseId)?.name || 'Unknown Course'
              };
              await saveRound(currentUser.uid, roundToSave);
            } catch (error) {
              console.error('Failed to save round:', error);
            }
          }
        }
      } else {
        // Save to localStorage for guests
        if (currentRound) {
          const roundToSave = {
            ...currentRound,
            courseName: currentRound.courseName || availableCourses.find(c => c.id === currentRound.courseId)?.name || 'Unknown Course'
          };
          localStorage.setItem('currentRound', JSON.stringify(roundToSave));
        }
        const historyToSave = history.map(round => ({
          ...round,
          courseName: round.courseName || availableCourses.find(c => c.id === round.courseId)?.name || 'Unknown Course'
        }));
        localStorage.setItem('roundHistory', JSON.stringify(historyToSave));
      }
    };

    saveData();
  }, [currentRound, history, currentUser]);

  const startNewRound = () => {
    console.log('🎯 Starting new round with selectedCourse:', selectedCourse);
    const roundCourseName = selectedCourse?.name || 'Unknown Course';
    const roundCourseId = selectedCourse?.id || COURSES[0].id;
    
    const newRound: Round = {
      id: Date.now().toString(),
      date: new Date().toISOString(),
      scores: {},
      isCompleted: false,
      courseId: roundCourseId,
      courseName: roundCourseName  // Explicitly capture at round creation
    };
    
    console.log('📝 Created new round:', { id: newRound.id, courseName: newRound.courseName, courseId: newRound.courseId });
    setCurrentRound(newRound);
    setCurrentHoleIdx(null);
    setActiveTab('map');
    // Wait 1.5 seconds then zoom to hole 1 over 2 seconds
    setTimeout(() => {
      setCurrentHoleIdx(0);
      setTempScore(currentCourseHoles[0].par);
    }, 1500);
  };

  const handleSaveScore = () => {
    if (!currentRound || currentHoleIdx === null) return;
    
    const holeNum = currentCourseHoles[currentHoleIdx].number;
    const newScores = {
      ...currentRound.scores,
      [holeNum]: { strokes: tempScore }
    };
    
    setCurrentRound({ ...currentRound, scores: newScores });
    
    // Move to next hole or scorecard if finished
    if (currentHoleIdx < currentCourseHoles.length - 1) {
      const nextIdx = currentHoleIdx + 1;
      setCurrentHoleIdx(nextIdx);
      setTempScore(currentCourseHoles[nextIdx].par);
    } else {
      setActiveTab('scorecard');
    }
  };

  const finishRound = () => {
    if (!currentRound) return;
    
    // Ensure courseName is preserved when finishing
    const completedRound = {
      ...currentRound,
      isCompleted: true,
      // Safeguard: if courseName is missing, look it up
      courseName: currentRound.courseName || availableCourses.find(c => c.id === currentRound.courseId)?.name || 'Unknown Course'
    };
    
    console.log('✅ Finishing round:', { id: completedRound.id, courseName: completedRound.courseName, courseId: completedRound.courseId });
    
    setHistory([completedRound, ...history]);
    setCurrentRound(null);
    setCurrentHoleIdx(null);
    setActiveTab('history');
    // Only remove from localStorage for guest users
    if (!currentUser?.uid) {
      localStorage.removeItem('currentRound');
    }
  };

  const handleDeleteRound = async (roundId: string) => {
    try {
      if (currentUser?.uid) {
        // Delete from Firestore for logged-in users only
        await deleteRoundFromFirestore(currentUser.uid, roundId);
      } else {
        // Remove from localStorage for guests only
        localStorage.setItem('roundHistory', JSON.stringify(history.filter(r => r.id !== roundId)));
      }
      // Remove from local history state
      setHistory(history.filter(r => r.id !== roundId));
      setDeleteConfirmRound(null);
      setSelectedHistoryRound(null);
    } catch (error) {
      console.error('Failed to delete round:', error);
    }
  };

  if (!hasValidKey) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-dark text-slate-100 p-6 font-sans">
        <div className="text-center max-w-md">
          <div className="w-20 h-20 bg-lime rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg shadow-lime/20">
            <Flag size={40} className="text-dark" />
          </div>
          <h2 className="text-3xl font-black mb-4 tracking-tight uppercase italic">Google Maps Required</h2>
          <p className="text-slate-400 mb-8">Set up your API key to start navigating the course.</p>
          <div className="bg-navy/50 p-6 rounded-2xl border border-white/10 text-left space-y-4 backdrop-blur-sm">
            <p className="text-sm"><span className="text-lime font-bold mr-2">1.</span> Get an API key from the Google Cloud Console.</p>
            <p className="text-sm"><span className="text-lime font-bold mr-2">2.</span> Open <strong>Settings</strong> (⚙️) → <strong>Secrets</strong>.</p>
            <p className="text-sm"><span className="text-lime font-bold mr-2">3.</span> Add <code>GOOGLE_MAPS_PLATFORM_KEY</code> as the secret name and paste your key.</p>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-dark">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-lime/20 border-t-lime rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-400">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <APIProvider apiKey={API_KEY} version="weekly">
      <div className="h-screen flex flex-col bg-dark text-slate-100 overflow-hidden font-sans italic-font-fix">
        <main className="flex-1 relative overflow-hidden pb-24 sm:pb-20">
          <AnimatePresence mode="wait">
            {activeTab === 'home' && (
              <motion.div 
                key="home"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.05 }}
                className="h-full w-full"
              >
                <HomeComponent
                  courses={availableCourses}
                  onSelectCourse={(course) => {
                    setSelectedCourse(course);
                    setCurrentHoleIdx(null);
                  }}
                  onPlayNow={() => {
                    startNewRound();
                  }}
                  loading={coursesLoading}
                />
              </motion.div>
            )}

            {activeTab === 'map' && (
              <motion.div 
                key="map"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="h-full w-full relative"
              >
                <MapView 
                  holes={currentCourseHoles} 
                  currentHoleIndex={currentHoleIdx}
                  onMarkerClick={(idx) => setCurrentHoleIdx(idx)}
                  userLocation={userLocation || undefined}
                />

                {currentHoleIdx !== null && (
                  <div className="absolute left-4 right-4 z-20" style={{ bottom: '30px' }}>
                    <motion.div 
                      initial={{ y: 50, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      className="bg-slate-900/90 backdrop-blur-md rounded-3xl border border-slate-700 shadow-2xl overflow-hidden"
                    >
                      {/* Header/Collapse Toggle */}
                      <div 
                        className="p-4 flex items-center justify-between bg-navy/50"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-lime text-dark flex items-center justify-center font-black text-sm italic">
                            {currentCourseHoles[currentHoleIdx].number}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="font-black text-sm leading-none uppercase italic tracking-tight">{currentCourseHoles[currentHoleIdx].name}</h3>
                              <button 
                                onClick={(e) => { e.stopPropagation(); setShowTip(!showTip); }}
                                className="text-lime hover:text-lime/80 transition-colors"
                              >
                                <Info size={14} />
                              </button>
                              {currentCourseHoles[currentHoleIdx].hazard && (
                                <AlertTriangle size={14} className="text-white" />
                              )}
                            </div>
                            <p className="text-[10px] text-lime font-black uppercase mt-1 tracking-wider inline-flex items-center gap-2 italic">
                               PAR {currentCourseHoles[currentHoleIdx].par}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="flex gap-1">
                             <button 
                               disabled={currentHoleIdx === 0}
                               onClick={(e) => { e.stopPropagation(); setCurrentHoleIdx(Math.max(0, currentHoleIdx - 1)); }}
                               className="p-2 text-slate-400 hover:text-white disabled:opacity-30"
                             >
                               <ChevronLeft size={20} />
                             </button>
                             <button 
                               disabled={currentHoleIdx === currentCourseHoles.length - 1}
                               onClick={(e) => { e.stopPropagation(); setCurrentHoleIdx(Math.min(currentCourseHoles.length - 1, currentHoleIdx + 1)); }}
                               className="p-2 text-slate-400 hover:text-white disabled:opacity-30"
                             >
                               <ChevronRight size={20} />
                             </button>
                          </div>
                          <motion.div
                            onClick={() => setIsCardCollapsed(!isCardCollapsed)}
                            animate={{ rotate: isCardCollapsed ? 180 : 0 }}
                            className="text-slate-500 cursor-pointer hover:text-slate-400 transition-colors"
                          >
                            <ChevronRight size={18} className="rotate-90" />
                          </motion.div>
                        </div>
                      </div>

                      <AnimatePresence>
                        {!isCardCollapsed && (
                          <motion.div 
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="px-5 pb-5 pt-3"
                          >
                            <div className="space-y-3">
                              {showTip && (
                                <motion.div 
                                  initial={{ opacity: 0, y: -10 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  exit={{ opacity: 0, y: -10 }}
                                  className="bg-navy/60 border border-lime/30 rounded-lg p-3 text-sm text-slate-200 italic leading-relaxed"
                                >
                                  {currentCourseHoles[currentHoleIdx].tip}
                                </motion.div>
                              )}
                              <div 
                                onClick={() => currentCourseHoles[currentHoleIdx].teeImage && setLightboxImage({ 
                                  url: getImagePath(currentCourseHoles[currentHoleIdx].teeImage!), 
                                  title: `Hole ${currentCourseHoles[currentHoleIdx].number} Tee` 
                                })}
                                className={`flex gap-2 items-start py-2 px-3 bg-slate-950/50 rounded-xl border border-slate-800 transition-colors ${currentCourseHoles[currentHoleIdx].teeImage ? 'cursor-pointer hover:bg-slate-800/80 active:scale-[0.98]' : ''}`}
                              >
                                <div className="mt-1 w-2 h-2 rounded-full bg-white border border-green-500 shrink-0" />
                                <div className="flex-1">
                                  {currentCourseHoles[currentHoleIdx].teeImage && <div className="float-right ml-2 mt-1"><ImageIcon size={24} className="text-lime" /></div>}
                                  <p className="text-[10px] text-slate-500 uppercase font-bold tracking-tight">
                                    Tee
                                  </p>
                                  <p className="text-xs text-slate-200 font-medium">{currentCourseHoles[currentHoleIdx].teeDescription}</p>
                                </div>
                              </div>
                              <div 
                                onClick={() => currentCourseHoles[currentHoleIdx].pinImage && setLightboxImage({ 
                                  url: getImagePath(currentCourseHoles[currentHoleIdx].pinImage!), 
                                  title: `Hole ${currentCourseHoles[currentHoleIdx].number} Pin` 
                                })}
                                className={`flex gap-2 items-start py-2 px-3 bg-dark/50 rounded-xl border border-white/5 transition-colors ${currentCourseHoles[currentHoleIdx].pinImage ? 'cursor-pointer hover:bg-navy/80 active:scale-[0.98]' : ''}`}
                              >
                                <div className="mt-1 w-2 h-2 rounded-full bg-lime shrink-0" />
                                <div className="flex-1">
                                  {currentCourseHoles[currentHoleIdx].pinImage && <div className="float-right ml-2 mt-1"><ImageIcon size={24} className="text-lime" /></div>}
                                  <p className="text-[10px] text-slate-500 uppercase font-bold tracking-tight">
                                    Pin
                                  </p>
                                  <p className="text-xs text-slate-200 font-medium">{currentCourseHoles[currentHoleIdx].pinDescription}</p>
                                </div>
                              </div>

                              <div className="flex items-center justify-between border-t border-white/5 pt-4 mt-2">
                                <div className="flex items-center gap-3">
                                  <button 
                                    onClick={() => setTempScore(Math.max(1, tempScore - 1))}
                                    className="w-10 h-10 rounded-xl bg-navy border border-white/5 flex items-center justify-center text-xl font-bold hover:bg-navy/80"
                                  >
                                    -
                                  </button>
                                  <div className="text-center w-8">
                                    <p className="text-2xl font-black italic">{tempScore}</p>
                                  </div>
                                  <button 
                                    onClick={() => setTempScore(tempScore + 1)}
                                    className="w-10 h-10 rounded-xl bg-navy border border-white/5 flex items-center justify-center text-xl font-bold hover:bg-navy/80"
                                  >
                                    +
                                  </button>
                                </div>
                                <button 
                                  onClick={handleSaveScore}
                                  className="bg-lime text-dark px-5 py-3 rounded-xl font-[900] flex items-center gap-2 hover:bg-lime/90 transition-colors shadow-lg shadow-lime/20 italic"
                                >
                                  <Pencil size={18} />
                                  Mark Score
                                </button>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === 'scorecard' && (
              <motion.div 
                key="scorecard"
                initial={{ x: 100, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: -100, opacity: 0 }}
                className="h-full overflow-y-auto bg-dark"
              >
                {currentRound ? (
                  <Scorecard round={currentRound} holes={currentCourseHoles} onFinishRound={finishRound} />
                ) : (
                  <div className="h-full flex flex-col items-center justify-center p-6">
                    <div className="text-center">
                      <Trophy size={48} className="text-lime/40 mx-auto mb-4" />
                      <p className="text-slate-400 font-medium text-lg mb-2">No Active Round</p>
                      <p className="text-slate-500 text-sm">Start a round on the Home tab to view your scores here</p>
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === 'history' && (
              <motion.div 
                key="history"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="h-full p-6 overflow-y-auto pb-32 sm:pb-24 bg-dark"
              >
                <h2 className="text-3xl font-[900] mb-8 flex items-center gap-3 uppercase italic tracking-tighter">
                  <HistoryIcon size={32} className="text-lime" />
                  HISTORY
                </h2>
                {history.length === 0 ? (
                  <div className="text-center py-20 bg-navy/30 rounded-3xl border border-white/5 border-dashed">
                    <p className="text-slate-500 font-medium">No rounds completed yet.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {history.map(round => {
                      const roundCourse = availableCourses.find(c => c.id === round.courseId);
                      const courseName = round.courseName || roundCourse?.name || 'Unknown Course';
                      return (<div key={round.id} className="bg-navy/50 p-5 rounded-2xl border border-white/5 backdrop-blur-sm transition-all hover:border-lime/30">
                        <div className="flex justify-between items-center mb-3">
                          <div>
                            <p className="text-xs font-black text-lime uppercase tracking-widest italic">{new Date(round.date).toLocaleDateString()}</p>
                            <p className="text-[10px] text-slate-400 uppercase tracking-wider mt-1">{courseName}</p>
                          </div>
                          <p className="text-white/50 text-[10px] font-black uppercase">{roundCourse?.holes.length ?? 9} HOLES</p>
                        </div>
                        <div className="flex justify-between items-center">
                          <div>
                            <p className="text-4xl font-[1000] italic leading-none tracking-tighter">
                              {(Object.values(round.scores) as Score[]).reduce((a, b) => a + b.strokes, 0)}
                            </p>
                            <p className="text-[10px] uppercase text-slate-500 font-black mt-1">Total strokes</p>
                          </div>
                          <div className="flex gap-2">
                            <button 
                              onClick={() => setSelectedHistoryRound(round)}
                              className="p-3 bg-white/5 rounded-full text-lime transition-colors hover:bg-lime hover:text-dark"
                            >
                              <ChevronRight size={20} />
                            </button>
                            <button 
                              onClick={() => setDeleteConfirmRound(round.id)}
                              className="p-3 bg-white/5 rounded-full text-red-400 transition-colors hover:bg-red-500 hover:text-dark"
                            >
                              <Trash2 size={20} />
                            </button>
                          </div>
                        </div>
                      </div>);
                    })}
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === 'builder' && (
              <motion.div 
                key="builder"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="h-full overflow-y-auto scroll-smooth"
                style={{ WebkitOverflowScrolling: 'touch' }}
              >
                {currentUser ? (
                  <CourseBuilder 
                    editingCourse={editingCourse || undefined}
                    onCancel={() => setEditingCourse(null)}
                    onCourseSaved={() => setCourseRefreshTrigger(prev => prev + 1)}
                  />
                ) : (
                  <AuthModal onClose={() => setActiveTab('home')} />
                )}
              </motion.div>
            )}

            {activeTab === 'profile' && (
              <motion.div 
                key="profile"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="h-full"
              >
                <Profile 
                  onLogout={() => setActiveTab('home')}
                  onCloseAuthModal={() => setActiveTab('home')}
                  onEditCourse={(course) => {
                    setEditingCourse(course);
                    setActiveTab('builder');
                  }}
                  onDeleteCourse={(courseId) => {
                    setAvailableCourses(availableCourses.filter(c => c.id !== courseId));
                  }}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Lightbox */}
          <AnimatePresence>
            {lightboxImage && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setLightboxImage(null)}
                className="fixed inset-0 z-[100] bg-slate-950/95 backdrop-blur-xl flex flex-col items-center justify-center p-6"
              >
                <div className="absolute top-6 right-6">
                  <button className="p-3 bg-slate-800 rounded-full text-white">
                    <X size={24} />
                  </button>
                </div>
                <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.9, opacity: 0 }}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full max-w-lg aspect-square rounded-3xl overflow-hidden shadow-2xl border border-slate-800"
                >
                  <img 
                    src={lightboxImage.url} 
                    alt={lightboxImage.title}
                    className="w-full h-full object-cover"
                  />
                </motion.div>
                <h3 className="mt-6 text-xl font-bold text-slate-200">{lightboxImage.title}</h3>
                <p className="mt-2 text-slate-500 text-sm">Tap anywhere to close</p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Round Detail Modal */}
          {selectedHistoryRound && (
            <div
              onClick={() => setSelectedHistoryRound(null)}
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
                      <p className="text-xs text-slate-400 mt-1">{new Date(selectedHistoryRound.date).toLocaleDateString()}</p>
                      {selectedHistoryRound.courseName && (
                        <p className="text-xs text-slate-500 mt-1">{selectedHistoryRound.courseName}</p>
                      )}
                    </div>
                    <button 
                      onClick={() => setSelectedHistoryRound(null)}
                      className="p-2 hover:bg-white/10 rounded-lg"
                    >
                      <X size={20} />
                    </button>
                  </div>

                  <div className="space-y-3">
                    {(() => {
                      const roundCourse = availableCourses.find(c => c.id === selectedHistoryRound.courseId) || availableCourses[0];
                      return roundCourse.holes.map((hole) => {
                        const score = selectedHistoryRound.scores[hole.number];
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
                      });
                    })()}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Delete Round Confirmation Modal */}
          {deleteConfirmRound && (
            <div
              onClick={() => setDeleteConfirmRound(null)}
              className="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-xl flex items-center justify-center p-6"
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-sm bg-navy/80 rounded-3xl p-6 border border-slate-700"
              >
                <div className="flex items-center gap-3 mb-4">
                  <AlertTriangle className="text-red-500" size={24} />
                  <h3 className="text-xl font-black text-red-500 uppercase">Delete Round?</h3>
                </div>
                <p className="text-slate-300 text-sm mb-6">
                  This action cannot be undone. Your round history will be permanently deleted.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setDeleteConfirmRound(null)}
                    className="flex-1 px-4 py-2 bg-white/10 rounded-lg text-white font-bold hover:bg-white/20 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => deleteConfirmRound && handleDeleteRound(deleteConfirmRound)}
                    className="flex-1 px-4 py-2 bg-red-500 rounded-lg text-white font-bold hover:bg-red-600 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </main>

        <nav className="fixed bottom-0 left-0 right-0 h-24 sm:h-20 bg-dark/90 backdrop-blur-xl border-t border-white/5 flex items-center justify-between px-6 z-40" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          <div className="flex items-center justify-around flex-1">
            <NavButton 
              active={activeTab === 'home'} 
              icon={<Home strokeWidth={3} />} 
              label="Home" 
              onClick={() => setActiveTab('home')} 
            />
            <NavButton 
              active={activeTab === 'map'} 
              icon={<MapIcon strokeWidth={3} />} 
              label="Map" 
              onClick={() => setActiveTab('map')} 
            />
            <NavButton 
              active={activeTab === 'scorecard'} 
              icon={<ListIcon strokeWidth={3} />} 
              label="Score" 
              onClick={() => setActiveTab('scorecard')} 
            />
            <NavButton 
              active={activeTab === 'builder'} 
              icon={<Hammer strokeWidth={3} />} 
              label="Build" 
              onClick={() => {
                if (!currentUser) {
                  setShowAuthModal(true);
                } else {
                  setActiveTab('builder');
                }
              }} 
            />
            <NavButton 
              active={activeTab === 'history'} 
              icon={<HistoryIcon strokeWidth={3} />} 
              label="History" 
              onClick={() => setActiveTab('history')} 
            />
            <NavButton 
              active={activeTab === 'profile'} 
              icon={<User strokeWidth={3} />} 
              label="Profile" 
              onClick={() => {
                setActiveTab('profile');
              }} 
            />
          </div>
        </nav>

        {/* Auth Modal */}
        {showAuthModal && (
          <AuthModal onClose={() => setShowAuthModal(false)} />
        )}
      </div>
    </APIProvider>
  );
}

function NavButton({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`flex flex-col items-center gap-1 transition-all ${active ? 'text-lime scale-110' : 'text-slate-500 hover:text-slate-300'}`}
    >
      <div className={active ? 'drop-shadow-[0_0_8px_rgba(191,255,0,0.5)]' : ''}>
        {icon}
      </div>
      <span className={`text-[10px] font-black uppercase tracking-tighter italic ${active ? 'text-lime' : ''}`}>{label}</span>
    </button>
  );
}
