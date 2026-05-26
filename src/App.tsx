import { useState, useEffect, ReactNode, useRef, useMemo } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import { Map as MapIcon, List as ListIcon, History as HistoryIcon, Play, ChevronLeft, ChevronRight, Pencil, Flag, Trophy, Image as ImageIcon, X, Home, Info, AlertTriangle, Hammer, LogOut, User, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import MapView from './components/MapView';
import Scorecard from './components/Scorecard';
import CourseBuilder from './components/CourseBuilder';
import { Profile } from './components/Profile';
import HomeComponent from './components/Home';
import AddPlayersModal from './components/AddPlayersModal';
import RoundDetailModal from './components/RoundDetailModal';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AuthModal } from './components/AuthModal';
import { getPublishedCourses, getUserCourses, getCourseById, saveRound, getUserRounds, deleteRound as deleteRoundFromFirestore, deleteAllIncompleteRounds } from './utils/courseService';
import { captureGPSLocation } from './utils/geolocation';
import { sortCoursesByDistance, calculateDistance } from './utils/distance';
import type { Course as FirestoreCourse, CourseHole } from './utils/courseService';
import { COURSES, type Course } from './constants/course';
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
  const { currentUser, userProfile, loading } = useAuth();
  const [activeTab, setActiveTab] = useState<'home' | 'map' | 'scorecard' | 'history' | 'builder' | 'profile'>('home');
  const [showAuthModal, setShowAuthModal] = useState(() => {
    // Auto-open auth modal if redirected from PWA's "Open in Browser" fallback
    return new URLSearchParams(window.location.search).get('openAuth') === '1';
  });
  
  // Courses
  const [availableCourses, setAvailableCourses] = useState<Course[]>([]);
  const [sortedCourses, setSortedCourses] = useState<Course[]>([]);
  const [coursesLoading, setCoursesLoading] = useState(true);
  const [coursesError, setCoursesError] = useState<string | null>(null);
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  
  // Geolocation
  // Geolocation
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const locationInitializedRef = useRef(false);
  
  // Load cached location on first mount
  useEffect(() => {
    if (!locationInitializedRef.current) {
      locationInitializedRef.current = true;
      try {
        const cached = localStorage.getItem('userLocation');
        if (cached) {
          const location = JSON.parse(cached);
          console.log('📍 Loaded cached location on startup:', location);
          setUserLocation(location);
        }
      } catch (error) {
        console.warn('Failed to parse cached location');
      }
    }
  }, []);

  // Capture active location on app load (so map is ready when user clicks map tab)
  useEffect(() => {
    const captureOnLoad = async () => {
      if (!isCapturingLocationRef.current && lastLocationCaptureRef.current === 0) {
        console.log('📍 Capturing fresh location on app load...');
        isCapturingLocationRef.current = true;
        mapSessionLocationCapturedRef.current = true; // Mark as captured so map view doesn't recapture
        
        try {
          setLocationError(null);
          setLocationErrorCode(null);
          const location = await captureGPSLocation(10000, 10);
          console.log('✅ Location captured on load:', location);
          setUserLocation(location);
          setShowLocationRetryPrompt(false);
          lastLocationCaptureRef.current = Date.now();
          loadTimeLocationCapturedRef.current = true; // Mark that we captured on load
          // Cache the location for next load
          localStorage.setItem('userLocation', JSON.stringify(location));
        } catch (error: any) {
          console.warn('❌ Failed to capture location on load:', error);
          // Don't show error on initial load, silently fail and use cached location
          setLocationErrorCode(error.code || 'UNKNOWN');
          // Only show error if user explicitly tries to use map
        } finally {
          isCapturingLocationRef.current = false;
        }
      }
    };

    captureOnLoad();
  }, []);

  const [locationError, setLocationError] = useState<string | null>(null);
  const [locationErrorCode, setLocationErrorCode] = useState<string | null>(null);
  const [showLocationRetryPrompt, setShowLocationRetryPrompt] = useState(false);

  const currentCourseHoles = selectedCourse?.holes || [];
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
  const [showAddPlayersModal, setShowAddPlayersModal] = useState(false);
  const [invalidSharedCourseId, setInvalidSharedCourseId] = useState<string | null>(null);
  const [activeSharedCourseId, setActiveSharedCourseId] = useState<string | null>(null);
  
  // Track if a shared course was loaded from URL to keep it pinned to top
  const sharedCourseIdRef = useRef<string | null>(null);
  const sharedCourseObjRef = useRef<Course | FirestoreCourse | null>(null);
  const lastLocationCaptureRef = useRef<number>(0);
  const locationCaptureTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isCapturingLocationRef = useRef(false);
  const lastMapTabRef = useRef(false); // Track last activeTab==='map' state
  const mapSessionLocationCapturedRef = useRef(false); // Track if we've captured location in this map session
  const loadTimeLocationCapturedRef = useRef(false); // Track if we captured location on app load
  const MIN_LOCATION_CAPTURE_INTERVAL = 5 * 60 * 1000; // 5 minutes

  // Helper: Find the first hole without a score in a round
  const getFirstUnscoredHoleIndex = (round: Round | null, holes: typeof currentCourseHoles): number | null => {
    if (!round) return null;
    
    // For multiplayer, check the active player's scores
    let scoresToCheck = round.scores;
    if (round.players && round.players.length > 0) {
      const activePlayerIdx = round.activePlayerIdx ?? 0;
      scoresToCheck = round.players[activePlayerIdx]?.scores || {};
    }
    
    for (let i = 0; i < holes.length; i++) {
      const holeNumber = holes[i].number;
      if (!scoresToCheck[holeNumber]) {
        return i;
      }
    }
    
    // All holes scored - round is complete
    return null;
  };

  // Helper: Get current player's scores (multiplayer support)
  const getCurrentPlayerScores = (round: Round | null) => {
    if (!round) return {};
    
    if (round.players && round.players.length > 0) {
      const activePlayerIdx = round.activePlayerIdx ?? 0;
      return round.players[activePlayerIdx]?.scores || {};
    }
    
    return round.scores;
  };

  // Helper: Switch to next player
  const switchToNextPlayer = () => {
    if (!currentRound?.players || currentRound.players.length <= 1) return;
    
    const nextPlayerIdx = ((currentRound.activePlayerIdx ?? 0) + 1) % currentRound.players.length;
    setCurrentRound({ ...currentRound, activePlayerIdx: nextPlayerIdx });
    if (currentHoleIdx !== null) {
      setTempScore(currentCourseHoles[currentHoleIdx].par);
    }
  };

  // Convert Firestore course to local Course format
  const convertFirestoreCourse = (fsCourse: FirestoreCourse): Course => {
    return {
      id: fsCourse.id,
      name: fsCourse.courseName,
      location: 'User Created Course',
      description: fsCourse.description,
      headerImage: fsCourse.headerImage || null,
      ...(fsCourse.averageRating !== undefined && { averageRating: fsCourse.averageRating }),
      ...(fsCourse.totalRatings !== undefined && { totalRatings: fsCourse.totalRatings }),
      holes: (fsCourse.holes || [])
        .filter((hole): hole is CourseHole => hole !== null && hole !== undefined)
        .map((hole, idx) => ({
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

        // Check for shared course via URL parameter (?c=courseId)
        const params = new URLSearchParams(window.location.search);
        const sharedCourseId = params.get('c');
        if (sharedCourseId) {
          try {
            console.log('🔄 Loading shared course:', sharedCourseId);
            const sharedCourse = await getCourseById(sharedCourseId);
            if (sharedCourse) {
              // Check if not already in courses array
              if (!courses.find(c => c.id === sharedCourseId)) {
                const converted = convertFirestoreCourse(sharedCourse);
                courses.push(converted);
                console.log('✅ Loaded shared course:', sharedCourse.courseName);
              }
            } else {
              console.warn('⚠️ Shared course not found:', sharedCourseId);
            }
          } catch (err) {
            console.warn('⚠️ Failed to load shared course:', err);
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

  // Capture fresh location continuously on map, lazily in background elsewhere
  // On map: real-time updates every 2 seconds
  // Elsewhere: update silently if location changed significantly
  // Skip if a shared course is being displayed
  useEffect(() => {
    const delayedCapture = setTimeout(() => {
      const shouldCapture = activeTab === 'map' ? !isCapturingLocationRef.current && !activeSharedCourseId : !currentHoleIdx && !isCapturingLocationRef.current && !activeSharedCourseId;
      if (shouldCapture) {
        console.log('📍 Capturing fresh geolocation' + (activeTab === 'map' ? ' (real-time on map)' : ' (lazy)') + '...');
        isCapturingLocationRef.current = true;
        
        const captureLocation = async () => {
          try {
            setLocationError(null);
            setLocationErrorCode(null);
            const freshLocation = await captureGPSLocation(10000, 10);
            console.log('✅ Fresh location captured in background:', freshLocation);
            
            // Always save to localStorage for next load
            localStorage.setItem('userLocation', JSON.stringify(freshLocation));
            lastLocationCaptureRef.current = Date.now();
            
            // Always update location on map view (real-time tracking)
            // On other views, only update if location changed significantly
            if (activeTab === 'map') {
              console.log('📍 Location updated (real-time on map):', freshLocation);
              setUserLocation(freshLocation);
              setShowLocationRetryPrompt(false);
            } else if (userLocation) {
              const distance = calculateDistance(
                userLocation.lat,
                userLocation.lng,
                freshLocation.lat,
                freshLocation.lng
              );
              
              if (distance > 0.06) { // ~100 meters in miles
                console.log('📍 Location changed significantly, updating display...');
                setUserLocation(freshLocation);
                setShowLocationRetryPrompt(false);
              } else {
                console.log('📍 Location unchanged (moved only', distance.toFixed(3), 'mi), no re-render');
              }
            }
          } catch (error: any) {
            console.warn('⚠️ Background location capture failed:', error);
            setLocationErrorCode(error.code || 'UNKNOWN');
            // Show retry prompt for permission denied or location services disabled
            if (error.code === 'PERMISSION_DENIED' || error.code === 'POSITION_UNAVAILABLE') {
              setShowLocationRetryPrompt(true);
            }
            // Don't show error if we have cached location
            if (!userLocation) {
              setLocationError(error.message || 'Could not get your location');
            }
          } finally {
            isCapturingLocationRef.current = false;
          }
        };

        captureLocation();
      }
    }, 2000); // Wait 2 seconds before capturing fresh location
    
    return () => clearTimeout(delayedCapture);
  }, [currentHoleIdx, activeTab, activeSharedCourseId]);

  // Capture user location when map view is opened (with smart caching)
  // Skip if a shared course is being displayed
  // Only captures once per map view session (unless location was captured on app load)
  useEffect(() => {
    const isMapViewActive = activeTab === 'map' && currentHoleIdx === null && !activeSharedCourseId;
    
    // Detect when entering map view for a new session
    if (isMapViewActive && !lastMapTabRef.current) {
      console.log('🗺️ Entered map view - will capture location once this session');
      // If we haven't captured yet in this map session, reset flag to allow capture
      // (unless we captured on app load, in which case reuse that)
      if (!loadTimeLocationCapturedRef.current) {
        mapSessionLocationCapturedRef.current = false;
      }
      // If we did capture on load, keep flag true and mark the on-load capture as used
      if (loadTimeLocationCapturedRef.current) {
        loadTimeLocationCapturedRef.current = false; // Mark on-load capture as consumed
        console.log('🗺️ Using location captured on app load');
      }
    }
    
    // Detect when leaving map view - reset for next session
    if (!isMapViewActive && lastMapTabRef.current) {
      console.log('🗺️ Left map view - reset location capture flag for next session');
      mapSessionLocationCapturedRef.current = false;
    }
    
    lastMapTabRef.current = isMapViewActive;
    
    // Capture location once per map session
    if (isMapViewActive && !mapSessionLocationCapturedRef.current && !isCapturingLocationRef.current) {
      console.log('📍 Capturing geolocation for map view...');
      isCapturingLocationRef.current = true;
      mapSessionLocationCapturedRef.current = true; // Mark as captured immediately to prevent duplicate requests
      
      const captureLocation = async () => {
        try {
          setLocationError(null);
          setLocationErrorCode(null);
          const location = await captureGPSLocation(10000, 10);
          console.log('✅ Location captured successfully:', location);
          setUserLocation(location);
          setShowLocationRetryPrompt(false);
          lastLocationCaptureRef.current = Date.now();
          // Cache the location for next load
          localStorage.setItem('userLocation', JSON.stringify(location));
        } catch (error: any) {
          console.warn('❌ Failed to capture location:', error);
          setLocationErrorCode(error.code || 'UNKNOWN');
          setLocationError(error.message || 'Could not get your location');
          // Show retry prompt for permission denied or location services disabled
          if (error.code === 'PERMISSION_DENIED' || error.code === 'POSITION_UNAVAILABLE') {
            setShowLocationRetryPrompt(true);
          }
        } finally {
          isCapturingLocationRef.current = false;
        }
      };

      captureLocation();
    }
  }, [activeTab, currentHoleIdx]);

  // Sort courses by distance when location becomes available
  // But only if a shared course is NOT being displayed
  useEffect(() => {
    if (userLocation && availableCourses.length > 0 && !activeSharedCourseId) {
      console.log('🎯 Sorting courses by distance from user location...');
      const sorted = sortCoursesByDistance(availableCourses, userLocation.lat, userLocation.lng);
      setSortedCourses(sorted);
    }
  }, [userLocation, availableCourses, activeSharedCourseId]);

  // Clear shared course tracking when user leaves home or starts a round
  // Keep location on map even when viewing a specific hole
  useEffect(() => {
    if (activeTab !== 'home' || currentHoleIdx !== null) {
      setActiveSharedCourseId(null);
    }
    
    // Only clear location when leaving map view, not when viewing a hole on map
    if (activeTab !== 'map' && currentHoleIdx !== null) {
      setUserLocation(null);
      setLocationError(null);
    }
  }, [activeTab, currentHoleIdx]);

  // Clear location when leaving map view (but not when in an active round)
  useEffect(() => {
    if (activeTab !== 'map' && currentHoleIdx === null && activeTab !== 'home') {
      console.log('📍 Clearing location - user left map view');
      setUserLocation(null);
      setLocationError(null);
    }
  }, [activeTab, currentHoleIdx]);

  // Cleanup: Cancel any pending location capture if component unmounts
  useEffect(() => {
    return () => {
      if (locationCaptureTimeoutRef.current) {
        clearTimeout(locationCaptureTimeoutRef.current);
      }
    };
  }, []);

  // Ensure selectedCourse is valid when availableCourses changes
  useEffect(() => {
    if (availableCourses.length > 0) {
      if (!selectedCourse || !availableCourses.find(c => c.id === selectedCourse.id)) {
        setSelectedCourse(availableCourses[0]);
      }
    } else {
      setSelectedCourse(null);
    }
  }, [availableCourses]);

  // Load shared course from URL parameter and switch to home view
  useEffect(() => {
    const loadSharedCourse = async () => {
      const params = new URLSearchParams(window.location.search);
      const sharedCourseId = params.get('c');
      
      if (!sharedCourseId) {
        sharedCourseObjRef.current = null;
        return;
      }
      
      // First check if it's already in availableCourses
      let sharedCourse = availableCourses.find(c => c.id === sharedCourseId);
      
      // If not found in available courses, try to load it directly
      if (!sharedCourse && availableCourses.length > 0) {
        try {
          console.log('📍 Shared course not in available courses, attempting to load:', sharedCourseId);
          const firestoreCourse = await getCourseById(sharedCourseId);
          if (firestoreCourse) {
            sharedCourse = convertFirestoreCourse(firestoreCourse);
            console.log('📍 Loaded shared course directly:', sharedCourse.name);
            
            // Store the shared course object for later use
            sharedCourseObjRef.current = sharedCourse;
            
            // Add to beginning of availableCourses so it shows as the first course in carousel
            setAvailableCourses(prev => {
              if (!prev.find(c => c.id === sharedCourseId)) {
                return [sharedCourse, ...prev];
              }
              return prev;
            });
          } else {
            // Course not found in Firestore
            console.warn('❌ Shared course not found in Firestore:', sharedCourseId);
            setInvalidSharedCourseId(sharedCourseId);
            sharedCourseObjRef.current = null;
            return;
          }
        } catch (err) {
          console.warn('❌ Failed to load shared course:', err);
          setInvalidSharedCourseId(sharedCourseId);
          sharedCourseObjRef.current = null;
          return;
        }
      } else if (sharedCourse) {
        // Shared course already in available courses
        sharedCourseObjRef.current = sharedCourse;
      }
      
      if (sharedCourse) {
        console.log('📍 Shared course found, switching to home view:', sharedCourse.name);
        setSelectedCourse(sharedCourse);
        setActiveSharedCourseId(sharedCourseId); // Trigger re-render with shared course at front
        setActiveTab('home');
        // Clear any previous invalid course error
        setInvalidSharedCourseId(null);
      } else if (sharedCourseId && !sharedCourse) {
        // Course was provided but couldn't be loaded
        console.warn('⚠️ Shared course not found:', sharedCourseId);
        setInvalidSharedCourseId(sharedCourseId);
        setActiveSharedCourseId(null); // Clear shared course
        sharedCourseObjRef.current = null;
      }
    };
    
    // Only run after courses have loaded
    if (availableCourses.length > 0 && !coursesLoading) {
      loadSharedCourse();
    }
  }, [coursesLoading]);

  // Load persistence (Firestore for logged-in users, localStorage for guests only)
  useEffect(() => {
    const loadData = async () => {
      const ensureCourseName = (round: Round) => {
        // Rounds should already have courseName stored from when they were created
        if (round.courseName) return round;
        
        // Fallback: try to find from availableCourses in case old rounds don't have it
        const course = availableCourses.find(c => c.id === round.courseId);
        return { ...round, courseName: course?.name || 'Unknown Course' };
      };

      if (currentUser?.uid) {
        try {
          const userRounds = await getUserRounds(currentUser.uid);
          // Migrate Firestore rounds to ensure they have courseName
          const migratedRounds = userRounds.map(ensureCourseName);
          
          // Separate active (incomplete) round from history (completed rounds)
          const activeRound = migratedRounds.find(r => !r.isCompleted);
          const completedRounds = migratedRounds.filter(r => r.isCompleted);
          
          if (activeRound) {
            console.log('📝 Restoring active round from Firestore:', { id: activeRound.id, courseName: activeRound.courseName });
            setCurrentRound(activeRound);
          }
          setHistory(completedRounds);
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
          console.log('📝 Restoring active round from localStorage:', { id: round.id, courseName: round.courseName });
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
  }, [currentUser, loading, availableCourses]);

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

  const startNewRound = async () => {
    if (!selectedCourse) {
      console.warn('⚠️ Cannot start round: no course selected');
      return;
    }
    
    // Show players modal to start multiplayer round
    setShowAddPlayersModal(true);
  };

  const handleStartMultiplayerRound = async (playerNames: string[]) => {
    if (!selectedCourse) {
      console.warn('⚠️ Cannot start round: no course selected');
      return;
    }
    
    setShowAddPlayersModal(false);
    console.log('🎯 Starting multiplayer round with players:', playerNames);
    
    // Clean up any existing incomplete rounds first
    if (currentUser?.uid) {
      try {
        console.log('🧹 Cleaning up any previous incomplete rounds...');
        await deleteAllIncompleteRounds(currentUser.uid);
      } catch (error) {
        console.warn('⚠️ Failed to clean up previous rounds:', error);
        // Continue anyway - this shouldn't block starting a new round
      }
    }
    
    const roundCourseName = selectedCourse.name || 'Unknown Course';
    const roundCourseId = selectedCourse.id;
    
    // Create players with empty scores
    const players = playerNames.map((name, idx) => ({
      id: `player_${idx}_${Date.now()}`,
      name,
      scores: {}
    }));
    
    const newRound: Round = {
      id: Date.now().toString(),
      date: new Date().toISOString(),
      scores: {}, // Keep for backward compatibility
      players,
      activePlayerIdx: 0,
      isCompleted: false,
      courseId: roundCourseId,
      courseName: roundCourseName
    };
    
    console.log('📝 Created multiplayer round:', { 
      id: newRound.id, 
      courseName: newRound.courseName, 
      players: players.map(p => p.name) 
    });
    
    setCurrentRound(newRound);
    setCurrentHoleIdx(null);
    setActiveTab('map');
    // Wait 1.5 seconds then zoom to hole 1
    setTimeout(() => {
      setCurrentHoleIdx(0);
      setTempScore(currentCourseHoles[0].par);
    }, 1500);
  };

  const handleSaveScore = () => {
    if (!currentRound || currentHoleIdx === null) return;
    
    const holeNum = currentCourseHoles[currentHoleIdx].number;
    const score = { strokes: tempScore };
    
    let updatedRound = { ...currentRound };
    
    // Handle multiplayer
    if (currentRound.players && currentRound.players.length > 0) {
      const activePlayerIdx = currentRound.activePlayerIdx ?? 0;
      const updatedPlayers = [...currentRound.players];
      updatedPlayers[activePlayerIdx] = {
        ...updatedPlayers[activePlayerIdx],
        scores: {
          ...updatedPlayers[activePlayerIdx].scores,
          [holeNum]: score
        }
      };
      updatedRound.players = updatedPlayers;
      
      // Check if all players have scored this hole
      const allPlayersScoredThisHole = updatedPlayers.every(p => p.scores[holeNum]);
      
      if (allPlayersScoredThisHole) {
        // All players scored this hole - advance to next hole
        if (currentHoleIdx < currentCourseHoles.length - 1) {
          setCurrentRound(updatedRound);
          const nextIdx = currentHoleIdx + 1;
          setCurrentHoleIdx(nextIdx);
          setTempScore(currentCourseHoles[nextIdx].par);
          // Reset to first player for next hole
          updatedRound.activePlayerIdx = 0;
          setCurrentRound(updatedRound);
        } else {
          // All holes complete - go to scorecard
          setCurrentRound(updatedRound);
          setActiveTab('scorecard');
        }
      } else {
        // Not all players scored yet - cycle to next player
        const nextPlayerIdx = (activePlayerIdx + 1) % updatedRound.players.length;
        updatedRound.activePlayerIdx = nextPlayerIdx;
        setCurrentRound(updatedRound);
        setTempScore(currentCourseHoles[currentHoleIdx].par);
      }
    } else {
      // Single player (backward compatibility)
      updatedRound.scores = {
        ...currentRound.scores,
        [holeNum]: score
      };
      setCurrentRound(updatedRound);
      
      // Move to next hole or scorecard
      if (currentHoleIdx < currentCourseHoles.length - 1) {
        const nextIdx = currentHoleIdx + 1;
        setCurrentHoleIdx(nextIdx);
        setTempScore(currentCourseHoles[nextIdx].par);
      } else {
        setActiveTab('scorecard');
      }
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

  const handleCancelRound = async () => {
    if (!currentRound) return;
    
    const roundId = currentRound.id;
    const userId = currentUser?.uid;
    console.log('❌ Canceling active round:', roundId, 'User:', userId);
    
    let deletionSuccessful = false;
    try {
      // Delete ALL incomplete rounds to clean up any extras
      if (userId) {
        console.log('🗑️ Deleting all incomplete rounds from Firestore...');
        await deleteAllIncompleteRounds(userId);
        console.log('✅ All incomplete rounds deleted from Firestore');
        deletionSuccessful = true;
      } else {
        console.log('🗑️ Deleting from localStorage (guest user)...');
      }
      
      // Always clear localStorage as a safety measure (for both logged-in and guest users)
      localStorage.removeItem('currentRound');
      console.log('✅ Removed from localStorage');
      
      if (!userId) {
        deletionSuccessful = true;
      }
      
    } catch (error) {
      console.error('❌ CRITICAL: Failed to cancel round:', error);
      // Still try to clear localStorage even if Firestore deletion fails
      localStorage.removeItem('currentRound');
      // Don't clear UI if deletion fails - let user see the round is still there
      return;
    }
    
    if (!deletionSuccessful) {
      console.error('❌ CRITICAL: Deletion was not successful');
      return;
    }
    
    // Only clear UI after deletion succeeds
    console.log('🎯 Clearing UI state...');
    setCurrentRound(null);
    setCurrentHoleIdx(null);
    setTempScore(4);
    console.log('✅ Round cancellation complete');
  };

  const handleRetryLocation = async () => {
    console.log('🔄 Retrying location capture after permission denied...');
    setShowLocationRetryPrompt(false);
    setLocationError(null);
    setLocationErrorCode(null);
    
    try {
      const location = await captureGPSLocation(10000, 10);
      console.log('✅ Location captured after retry:', location);
      setUserLocation(location);
      // Cache the location for next load
      localStorage.setItem('userLocation', JSON.stringify(location));
    } catch (error: any) {
      console.warn('❌ Retry failed:', error);
      setLocationErrorCode(error.code || 'UNKNOWN');
      setLocationError(error.message || 'Could not get your location');
      // Show retry prompt again if permission denied or location services disabled
      if (error.code === 'PERMISSION_DENIED' || error.code === 'POSITION_UNAVAILABLE') {
        setShowLocationRetryPrompt(true);
      }
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

  // Memoize the courses array passed to HomeComponent to prevent carousel reset
  // This must be called before the loading check to maintain consistent hook order
  const homeComponentCourses = useMemo(() => 
    activeSharedCourseId && sharedCourseObjRef.current
      ? (() => {
          // Use the stored shared course object and put it at front with all other courses
          const shared = sharedCourseObjRef.current;
          const others = availableCourses.filter(c => c.id !== activeSharedCourseId);
          return [shared, ...others];
        })()
      : (userLocation ? sortedCourses : availableCourses),
    [activeSharedCourseId, availableCourses, userLocation, sortedCourses]
  );

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
                  courses={homeComponentCourses}
                  userLocation={userLocation}
                  onSelectCourse={(course) => {
                    setSelectedCourse(course);
                    setCurrentHoleIdx(null);
                  }}
                  onPlayNow={() => {
                    startNewRound();
                  }}
                  loading={coursesLoading}
                  currentRound={currentRound}
                  onResumeRound={() => {
                    if (currentRound && !currentRound.isCompleted) {
                      // Set the correct course for the active round
                      const roundCourse = availableCourses.find(c => c.id === currentRound.courseId) || 
                                        COURSES.find(c => c.id === currentRound.courseId);
                      if (roundCourse) {
                        setSelectedCourse(roundCourse);
                      }
                      
                      setActiveTab('map');
                      setTimeout(() => {
                        const firstUnscoredIdx = getFirstUnscoredHoleIndex(currentRound, roundCourse?.holes || currentCourseHoles);
                        if (firstUnscoredIdx !== null) {
                          console.log('📍 Resuming round at hole:', firstUnscoredIdx + 1, 'on course:', roundCourse?.name);
                          setCurrentHoleIdx(firstUnscoredIdx);
                          setTempScore((roundCourse?.holes || currentCourseHoles)[firstUnscoredIdx].par);
                        }
                      }, 500);
                    }
                  }}
                  onCancelRound={handleCancelRound}
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
                  holes={currentHoleIdx !== null ? currentCourseHoles : []} 
                  currentHoleIndex={currentHoleIdx}
                  onMarkerClick={(idx) => setCurrentHoleIdx(idx)}
                  userLocation={userLocation || undefined}
                />

                {currentHoleIdx !== null && (
                  <div className="absolute left-4 right-4 z-20" style={{ bottom: '120px' }}>
                    <motion.div 
                      initial={{ y: 50, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      className="bg-slate-900/90 backdrop-blur-md rounded-3xl border border-slate-700 shadow-2xl overflow-hidden"
                    >
                      {/* Header/Collapse Toggle */}
                      <div 
                        className="p-4 flex items-center justify-between bg-navy/50"
                      >
                        <div className="flex items-center gap-3 flex-1">
                          <div className="w-8 h-8 rounded-full bg-lime text-dark flex items-center justify-center font-black text-sm italic">
                            {currentCourseHoles[currentHoleIdx].number}
                          </div>
                          <div className="flex-1">
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
                            <div className="flex gap-2 items-center mt-1">
                              <p className="text-[10px] text-lime font-black uppercase tracking-wider italic">
                                 PAR {currentCourseHoles[currentHoleIdx].par}
                              </p>
                            </div>
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
                                  {currentRound?.players && currentRound.players.length > 1 && (
                                    <div className="ml-auto overflow-x-auto scrollbar-hide">
                                      <div className="flex gap-2 pb-2">
                                        {currentRound.players.map((player, idx) => (
                                          <button
                                            key={player.id}
                                            onClick={() => {
                                              setCurrentRound({ ...currentRound, activePlayerIdx: idx });
                                              if (currentHoleIdx !== null) {
                                                setTempScore(currentCourseHoles[currentHoleIdx].par);
                                              }
                                            }}
                                            className={`px-3 py-1 rounded-lg font-bold text-xs uppercase tracking-tight whitespace-nowrap transition-colors ${
                                              idx === (currentRound.activePlayerIdx ?? 0)
                                                ? 'bg-lime text-dark'
                                                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                                            }`}
                                          >
                                            {player.name}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  )}
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
                  <Scorecard 
                    round={currentRound} 
                    holes={currentCourseHoles} 
                    onFinishRound={finishRound}
                    onViewHole={(holeIndex) => {
                      setActiveTab('map');
                      setCurrentHoleIdx(holeIndex);
                    }}
                  />
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
                      
                      // Get scores from first player (for multiplayer) or main scores (for single player)
                      const getFirstPlayerScores = () => {
                        if (round.players && round.players.length > 0) {
                          return round.players[0]?.scores || {};
                        }
                        return round.scores;
                      };
                      
                      const firstPlayerScores = getFirstPlayerScores();
                      const totalStrokes = Object.values(firstPlayerScores).reduce((a: number, b: any) => a + b.strokes, 0);
                      
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
                              {totalStrokes}
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
                  onViewFavoriteCourse={(course) => {
                    // Convert Firestore course to local format
                    const localCourse: Course = {
                      id: course.id,
                      name: course.courseName,
                      location: 'Published Course',
                      description: course.description,
                      headerImage: course.headerImage || null,
                      ...(course.averageRating !== undefined && { averageRating: course.averageRating }),
                      ...(course.totalRatings !== undefined && { totalRatings: course.totalRatings }),
                      holes: (course.holes || [])
                        .filter((hole): hole is CourseHole => hole !== null && hole !== undefined)
                        .map((hole, idx) => ({
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
                    
                    setSelectedCourse(localCourse);
                    setActiveTab('map');
                    
                    setTimeout(() => {
                      setCurrentHoleIdx(0);
                      setTempScore(localCourse.holes[0].par);
                      console.log('🗺️ Viewing favorite course:', localCourse.name);
                    }, 300);
                  }}
                  onViewBuiltCourse={(course) => {
                    // Convert Firestore course to local format
                    const localCourse: Course = {
                      id: course.id,
                      name: course.courseName,
                      location: 'User Created Course',
                      description: course.description,
                      headerImage: course.headerImage || null,
                      ...(course.averageRating !== undefined && { averageRating: course.averageRating }),
                      ...(course.totalRatings !== undefined && { totalRatings: course.totalRatings }),
                      holes: (course.holes || [])
                        .filter((hole): hole is CourseHole => hole !== null && hole !== undefined)
                        .map((hole, idx) => ({
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
                    
                    setSelectedCourse(localCourse);
                    setActiveTab('map');
                    
                    setTimeout(() => {
                      setCurrentHoleIdx(0);
                      setTempScore(localCourse.holes[0].par);
                      console.log('🗺️ Viewing built course:', localCourse.name);
                    }, 300);
                  }}
                  onRequestLocation={async () => {
                    console.log('📍 Location permission requested from Profile');
                    // Clear cached location to force fresh request
                    localStorage.removeItem('userLocation');
                    setUserLocation(null);
                    setLocationError(null);
                    setLocationErrorCode(null);
                    
                    try {
                      const location = await captureGPSLocation(10000, 10);
                      console.log('✅ Location captured from Profile:', location);
                      setUserLocation(location);
                      setShowLocationRetryPrompt(false);
                      localStorage.setItem('userLocation', JSON.stringify(location));
                    } catch (error: any) {
                      console.warn('❌ Failed to capture location from Profile:', error);
                      setLocationErrorCode(error.code || 'UNKNOWN');
                      setLocationError(error.message || 'Could not get your location');
                      if (error.code === 'PERMISSION_DENIED' || error.code === 'POSITION_UNAVAILABLE') {
                        setShowLocationRetryPrompt(true);
                      }
                    }
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
            <RoundDetailModal
              round={selectedHistoryRound}
              courses={availableCourses}
              onClose={() => setSelectedHistoryRound(null)}
            />
          )}

          {/* Add Players Modal */}
          <AddPlayersModal 
            isOpen={showAddPlayersModal}
            onClose={() => setShowAddPlayersModal(false)}
            onStart={handleStartMultiplayerRound}
            defaultPlayerName={userProfile?.displayName || 'Player 1'}
          />

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
              onClick={() => {
                setActiveTab('map');
                // Auto-resume if there's an active round and no hole is currently selected
                if (currentRound && !currentRound.isCompleted && currentHoleIdx === null) {
                  setTimeout(() => {
                    // Set the correct course for the active round
                    const roundCourse = availableCourses.find(c => c.id === currentRound.courseId) || 
                                      COURSES.find(c => c.id === currentRound.courseId);
                    if (roundCourse) {
                      setSelectedCourse(roundCourse);
                    }
                    
                    const firstUnscoredIdx = getFirstUnscoredHoleIndex(currentRound, roundCourse?.holes || currentCourseHoles);
                    if (firstUnscoredIdx !== null) {
                      console.log('📍 Auto-resuming round at hole:', firstUnscoredIdx + 1, 'on course:', roundCourse?.name);
                      setCurrentHoleIdx(firstUnscoredIdx);
                      setTempScore((roundCourse?.holes || currentCourseHoles)[firstUnscoredIdx].par);
                    }
                  }, 500);
                }
              }} 
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

        {/* Location Permission Retry Modal */}
        <AnimatePresence>
          {showLocationRetryPrompt && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowLocationRetryPrompt(false)}
              className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-dark rounded-2xl p-8 max-w-sm w-full mx-4 border border-white/10"
              >
                <div className="text-center">
                  <div className="inline-block p-3 bg-red-500/20 rounded-full mb-4">
                    <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <h2 className="text-2xl font-black text-white mb-3">
                    {locationErrorCode === 'POSITION_UNAVAILABLE' ? 'Location Services Disabled' : 'Location Permission Required'}
                  </h2>
                  <p className="text-white/60 mb-6 text-sm">
                    Street Golf needs your location to sort courses by distance and show accurate hole distances.
                  </p>
                  
                  {locationErrorCode === 'POSITION_UNAVAILABLE' ? (
                    <div className="bg-white/5 rounded-lg p-4 mb-6 text-left border border-white/10">
                      <p className="font-bold text-white mb-3 text-sm">Enable Location Services:</p>
                      <div className="text-white/50 text-xs space-y-2">
                        <div>
                          <p className="font-semibold text-white/70 mb-1">📱 iOS:</p>
                          <p>Settings → Privacy → Location Services → Enable it → Find "Street Golf" and select "While Using"</p>
                        </div>
                        <div className="mt-3">
                          <p className="font-semibold text-white/70 mb-1">🤖 Android:</p>
                          <p>Settings → Location → Enable Location → App Permissions → Grant location access to Street Golf</p>
                        </div>
                        <div className="mt-3">
                          <p className="font-semibold text-white/70 mb-1">🌐 Browser:</p>
                          <p>Check your browser's address bar for a location icon → Click it → Select "Allow"</p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-white/5 rounded-lg p-4 mb-6 text-left border border-white/10">
                      <p className="font-bold text-white mb-3 text-sm">Grant Permission:</p>
                      <div className="text-white/50 text-xs space-y-2">
                        <p>When prompted, tap "Allow" to share your location with Street Golf.</p>
                        <p className="mt-2">If you previously denied permission:</p>
                        <div className="mt-2">
                          <p className="font-semibold text-white/70 mb-1">📱 iOS:</p>
                          <p>Settings → Privacy → Location Services → Street Golf → Select "While Using"</p>
                        </div>
                        <div className="mt-2">
                          <p className="font-semibold text-white/70 mb-1">🤖 Android:</p>
                          <p>Settings → Apps → Street Golf → Permissions → Location → Allow</p>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  <div className="flex gap-3">
                    <button
                      onClick={() => setShowLocationRetryPrompt(false)}
                      className="flex-1 px-4 py-2 bg-white/10 rounded-lg text-white font-bold hover:bg-white/20 transition-colors text-sm"
                    >
                      Dismiss
                    </button>
                    <button
                      onClick={handleRetryLocation}
                      className="flex-1 px-4 py-2 bg-lime text-dark rounded-lg font-bold hover:bg-lime/90 transition-colors text-sm"
                    >
                      Try Again
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Invalid Shared Course Modal */}
        <AnimatePresence>
          {invalidSharedCourseId && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setInvalidSharedCourseId(null)}
              className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            >
              <motion.div
                onClick={(e) => e.stopPropagation()}
                className="bg-navy/90 rounded-2xl p-6 max-w-sm border border-red-500/30 shadow-2xl"
              >
                <div className="text-center">
                  <div className="text-4xl mb-4">⚠️</div>
                  <h3 className="text-xl font-black text-red-400 uppercase italic tracking-tight mb-2">
                    Invalid Course ID
                  </h3>
                  <p className="text-slate-300 text-sm mb-6">
                    The course ID "<span className="text-lime font-bold">{invalidSharedCourseId}</span>" could not be found. 
                    It may have been deleted or the link may be incorrect.
                  </p>
                  <button
                    onClick={() => setInvalidSharedCourseId(null)}
                    className="w-full px-4 py-2 bg-lime text-dark rounded-lg font-bold hover:bg-lime/90 transition-colors"
                  >
                    Go to Home
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
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
