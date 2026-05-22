import React, { useState, useRef, useEffect } from 'react';
import { MapPin, Image as ImageIcon, Trash2, Plus, AlertCircle, Loader, X, ChevronLeft, Pencil } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { captureLocationWithFallback, formatAccuracy, isAccuracyGood } from '../utils/geolocation';
import { uploadImage, validateImageFile } from '../utils/imageUpload';
import { saveCourse } from '../utils/courseService';
import { getImagePath } from '../utils/paths';
import { useAuth } from '../context/AuthContext';
import CameraCapture from './CameraCapture';
import { LocationVerificationModal } from './LocationVerificationModal';
import { ManualLocationInput } from './ManualLocationInput';
import type { Course as FirestoreCourse } from '../utils/courseService';
import { db } from '../config/firebase';
import { updateDoc, setDoc, doc, Timestamp } from 'firebase/firestore';

interface HoleInProgress {
  id: string;
  name: string;
  par: number;
  teeLocation: { lat: number; lng: number } | null;
  pinLocation: { lat: number; lng: number } | null;
  teeDescription: string;
  pinDescription: string;
  teeImage: string | null;
  pinImage: string | null;
  tip: string;
  hazard: boolean;
}

export default function CourseBuilder({ 
  editingCourse, 
  onEditComplete,
  onCancel,
  onCourseSaved
}: { 
  editingCourse?: FirestoreCourse;
  onEditComplete?: () => void;
  onCancel?: () => void;
  onCourseSaved?: () => void;
}) {
  const { currentUser } = useAuth();
  const teeCameraInputRef = useRef<HTMLInputElement>(null);
  const teeFileInputRef = useRef<HTMLInputElement>(null);
  const pinCameraInputRef = useRef<HTMLInputElement>(null);
  const pinFileInputRef = useRef<HTMLInputElement>(null);

  const courseHeaderImageCameraInputRef = useRef<HTMLInputElement>(null);
  const courseHeaderImageFileInputRef = useRef<HTMLInputElement>(null);

  const [courseName, setCourseName] = useState('');
  const [courseHeaderImage, setCourseHeaderImage] = useState<string | null>(null);
  const [courseHeaderImageLoading, setCourseHeaderImageLoading] = useState(false);
  const [courseHeaderImageError, setCourseHeaderImageError] = useState<string | null>(null);
  const [courseHeaderImageMenuOpen, setCourseHeaderImageMenuOpen] = useState(false);
  const [courseHeaderImageCameraOpen, setCourseHeaderImageCameraOpen] = useState(false);

  const [holes, setHoles] = useState<HoleInProgress[]>([]);
  const [expandedHole, setExpandedHole] = useState<string | null>(null);
  const [editingHoleId, setEditingHoleId] = useState<string | null>(null);
  
  // GPS states - separate for form and edit
  const [teeGpsLoading, setTeeGpsLoading] = useState(false);
  const [teeGpsError, setTeeGpsError] = useState<string | null>(null);
  const [teeAccuracy, setTeeAccuracy] = useState<number | undefined>();
  const [pinGpsLoading, setPinGpsLoading] = useState(false);
  const [pinGpsError, setPinGpsError] = useState<string | null>(null);
  const [pinAccuracy, setPinAccuracy] = useState<number | undefined>();
  
  const [editTeeCpsLoading, setEditTeeGpsLoading] = useState(false);
  const [editTeeGpsError, setEditTeeGpsError] = useState<string | null>(null);
  const [editTeeAccuracy, setEditTeeAccuracy] = useState<number | undefined>();
  const [editPinGpsLoading, setEditPinGpsLoading] = useState(false);
  const [editPinGpsError, setEditPinGpsError] = useState<string | null>(null);
  const [editPinAccuracy, setEditPinAccuracy] = useState<number | undefined>();

  // Location verification modal
  const [locationModalOpen, setLocationModalOpen] = useState<null | 'tee' | 'pin' | 'editTee' | 'editPin'>(null);
  
  // Manual location input (for testing on desktop)
  const [manualLocationOpen, setManualLocationOpen] = useState<null | 'tee' | 'pin' | 'editTee' | 'editPin'>(null);

  // Photo upload states - separate for form and edit
  const [teePhotoLoading, setTeePhotoLoading] = useState(false);
  const [teePhotoError, setTeePhotoError] = useState<string | null>(null);
  const [pinPhotoLoading, setPinPhotoLoading] = useState(false);
  const [pinPhotoError, setPinPhotoError] = useState<string | null>(null);
  
  const [editTeePhotoLoading, setEditTeePhotoLoading] = useState(false);
  const [editTeePhotoError, setEditTeePhotoError] = useState<string | null>(null);
  const [editPinPhotoLoading, setEditPinPhotoLoading] = useState(false);
  const [editPinPhotoError, setEditPinPhotoError] = useState<string | null>(null);

  // Photo menu states
  const [teePhotoMenuOpen, setTeePhotoMenuOpen] = useState(false);
  const [pinPhotoMenuOpen, setPinPhotoMenuOpen] = useState(false);
  const [editTeePhotoMenuOpen, setEditTeePhotoMenuOpen] = useState(false);
  const [editPinPhotoMenuOpen, setEditPinPhotoMenuOpen] = useState(false);

  // Camera modal states
  const [teeCameraOpen, setTeeCameraOpen] = useState(false);
  const [pinCameraOpen, setPinCameraOpen] = useState(false);
  const [editTeeCameraOpen, setEditTeeCameraOpen] = useState(false);
  const [editPinCameraOpen, setEditPinCameraOpen] = useState(false);

  // Publishing states
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishSuccess, setPublishSuccess] = useState(false);
  const [courseVisibility, setCourseVisibility] = useState<'public' | 'private'>('public');

  const [currentHole, setCurrentHole] = useState<Partial<HoleInProgress>>({
    name: '',
    par: 3,
    teeLocation: null,
    pinLocation: null,
    teeDescription: '',
    pinDescription: '',
    teeImage: null,
    pinImage: null,
    tip: '',
    hazard: false,
  });

  const [editingHoleData, setEditingHoleData] = useState<Partial<HoleInProgress> | null>(null);

  // Counter for unique hole IDs
  const holeIdCounterRef = useRef(0);

  // Helper function to regenerate hole IDs to ensure uniqueness
  const regenerateHoleIds = (holesToRegenerate: HoleInProgress[]) => {
    holeIdCounterRef.current = 0;
    return holesToRegenerate.map((hole, idx) => ({
      ...hole,
      id: `hole-${++holeIdCounterRef.current}`
    }));
  };

  // Get refs for edit camera/file inputs
  const editTeeCameraInputRef = useRef<HTMLInputElement>(null);
  const editTeeFileInputRef = useRef<HTMLInputElement>(null);
  const editPinCameraInputRef = useRef<HTMLInputElement>(null);
  const editPinFileInputRef = useRef<HTMLInputElement>(null);

  // Ref for scrolling to newly added hole
  const holesListRef = useRef<HTMLDivElement>(null);

  // Load course data when editing
  useEffect(() => {
    if (editingCourse) {
      setCourseName(editingCourse.courseName);
      setCourseHeaderImage(editingCourse.headerImage || null);
      setCourseVisibility(editingCourse.visibility || 'public');
      
      // Convert and regenerate IDs to ensure uniqueness
      const convertedHoles: HoleInProgress[] = editingCourse.holes.map(hole => ({
        id: hole.id,
        name: hole.name,
        par: hole.par,
        teeLocation: hole.teeLocation,
        pinLocation: hole.pinLocation,
        teeDescription: hole.teeDescription,
        pinDescription: hole.pinDescription,
        teeImage: hole.teeImage,
        pinImage: hole.pinImage,
        tip: hole.tip,
        hazard: hole.hazard,
      }));
      
      // Regenerate hole IDs to ensure they're unique
      const holesWithUniqueIds = regenerateHoleIds(convertedHoles);
      setHoles(holesWithUniqueIds);
      
      setCurrentHole({
        name: '',
        par: 3,
        teeLocation: null,
        pinLocation: null,
        teeDescription: '',
        pinDescription: '',
        teeImage: null,
        pinImage: null,
        tip: '',
        hazard: false,
      });
    }
  }, [editingCourse]);

  const addHole = () => {
    if (currentHole.name && currentHole.teeLocation && currentHole.pinLocation) {
      const newHole: HoleInProgress = {
        id: `hole-${++holeIdCounterRef.current}`,
        name: currentHole.name || '',
        par: currentHole.par || 3,
        teeLocation: currentHole.teeLocation,
        pinLocation: currentHole.pinLocation,
        teeDescription: currentHole.teeDescription || '',
        pinDescription: currentHole.pinDescription || '',
        teeImage: currentHole.teeImage || null,
        pinImage: currentHole.pinImage || null,
        tip: currentHole.tip || '',
        hazard: currentHole.hazard || false,
      };

      setHoles([...holes, newHole]);
      // Collapse the form after adding a hole
      setExpandedHole(null);
      setCurrentHole({
        name: '',
        par: 3,
        teeLocation: null,
        pinLocation: null,
        teeDescription: '',
        pinDescription: '',
        teeImage: null,
        pinImage: null,
        tip: '',
        hazard: false,
      });

      // Scroll to the newly added hole
      setTimeout(() => {
        const holesContainer = holesListRef.current;
        if (holesContainer) {
          holesContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 100);
    }
  };

  const editHole = (hole: HoleInProgress) => {
    setEditingHoleId(hole.id);
    setExpandedHole(hole.id);
    setEditingHoleData({
      name: hole.name,
      par: hole.par,
      teeLocation: hole.teeLocation,
      pinLocation: hole.pinLocation,
      teeDescription: hole.teeDescription,
      pinDescription: hole.pinDescription,
      teeImage: hole.teeImage,
      pinImage: hole.pinImage,
      tip: hole.tip,
      hazard: hole.hazard,
    });
  };

  const saveHoleEdit = () => {
    if (!editingHoleId || !editingHoleData) return;
    
    const updatedHoles = holes.map(hole => 
      hole.id === editingHoleId ? { ...hole, ...editingHoleData } : hole
    );
    setHoles(updatedHoles);
    cancelHoleEdit();
  };

  const cancelHoleEdit = () => {
    setEditingHoleId(null);
    setEditingHoleData(null);
    setExpandedHole(null);
    setEditTeeCpsLoading(false);
    setEditTeeGpsError(null);
    setEditPinGpsLoading(false);
    setEditPinGpsError(null);
    setEditTeePhotoLoading(false);
    setEditTeePhotoError(null);
    setEditPinPhotoLoading(false);
    setEditPinPhotoError(null);
  };

  const removeHole = (id: string) => {
    setHoles(holes.filter(h => h.id !== id));
    if (editingHoleId === id) {
      cancelHoleEdit();
    }
  };

  const publishCourse = async () => {
    if (!currentUser) {
      setPublishError('You must be signed in to publish a course');
      return;
    }

    if (!courseName.trim()) {
      setPublishError('Please enter a course name');
      return;
    }

    if (holes.length === 0) {
      setPublishError('Please add at least one hole to your course');
      return;
    }

    setIsPublishing(true);
    setPublishError(null);
    setPublishSuccess(false);

    try {
      if (editingCourse) {
        // Update existing course
        const courseRef = doc(db, 'users', currentUser.uid, 'courses', editingCourse.id);
        
        // Clean holes array - reconstruct each hole with only expected fields
        const cleanedHoles = holes.map(hole => ({
          id: hole.id || '',
          name: hole.name || '',
          par: hole.par || 3,
          teeLocation: hole.teeLocation || null,
          pinLocation: hole.pinLocation || null,
          teeImage: hole.teeImage || null,
          pinImage: hole.pinImage || null,
          teeDescription: hole.teeDescription || '',
          pinDescription: hole.pinDescription || '',
          tip: hole.tip || '',
          hazard: hole.hazard === true,
        }));
        
        // Build update object, removing any undefined values
        const updateData: any = {
          courseName: courseName || '',
          holes: cleanedHoles,
          headerImage: courseHeaderImage || null,
          creatorName: currentUser.displayName || currentUser.email || 'Anonymous',
          visibility: courseVisibility,
          updatedAt: Timestamp.now(),
        };
        
        // Remove any undefined values
        Object.keys(updateData).forEach(key => {
          if (updateData[key] === undefined) delete updateData[key];
        });
        
        await updateDoc(courseRef, updateData);

        // Also update visibility in public courses collection
        const publicRef = doc(db, 'courses', editingCourse.id);
        await updateDoc(publicRef, {
          visibility: courseVisibility,
        }).catch(() => {
          // It's okay if this fails - course might not be in public collection yet
        });

        setPublishSuccess(true);
        setTimeout(() => {
          onEditComplete?.();
          onCourseSaved?.();
          setCourseName('');
          setHoles([]);
          setCurrentHole({
            name: '',
            par: 3,
            teeLocation: null,
            pinLocation: null,
            teeDescription: '',
            pinDescription: '',
            teeImage: null,
            pinImage: null,
            tip: '',
            hazard: false,
          });
          setCourseHeaderImage(null);
          setPublishSuccess(false);
        }, 2000);
      } else {
        // Create new course
        // Clean holes array - reconstruct each hole with only expected fields
        const cleanedHoles = holes.map(hole => ({
          id: hole.id || '',
          name: hole.name || '',
          par: hole.par || 3,
          teeLocation: hole.teeLocation || null,
          pinLocation: hole.pinLocation || null,
          teeImage: hole.teeImage || null,
          pinImage: hole.pinImage || null,
          teeDescription: hole.teeDescription || '',
          pinDescription: hole.pinDescription || '',
          tip: hole.tip || '',
          hazard: hole.hazard === true,
        }));
        
        const courseId = await saveCourse(currentUser.uid, {
          courseName: courseName || '',
          headerImage: courseHeaderImage || null,
          creatorName: currentUser.displayName || currentUser.email || 'Anonymous',
          holes: cleanedHoles,
          status: 'published',
          visibility: courseVisibility,
        });

        // Add to public courses collection with visibility
        try {
          const publicRef = doc(db, 'courses', courseId);
          await setDoc(publicRef, {
            id: courseId,
            userId: currentUser.uid,
            creatorUid: currentUser.uid,
            courseName,
            creatorName: currentUser.displayName || currentUser.email || 'Anonymous',
            visibility: courseVisibility,
            holesCount: holes.length,
            createdAt: Timestamp.now(),
            publishedAt: Timestamp.now(),
            previewTeeImage: holes[0]?.teeImage || null,
            previewPinImage: holes[0]?.pinImage || null,
          });
        } catch (err) {
          console.warn('Failed to add course to public collection:', err);
        }

        setPublishSuccess(true);
        onCourseSaved?.();

        // Reset form after 2 seconds
        setTimeout(() => {
          setCourseName('');
          setHoles([]);
          setCurrentHole({
            name: '',
            par: 3,
            teeLocation: null,
            pinLocation: null,
            teeDescription: '',
            pinDescription: '',
            teeImage: null,
            pinImage: null,
            tip: '',
            hazard: false,
          });
          setCourseHeaderImage(null);
          setPublishSuccess(false);
          setCourseVisibility('public');
        }, 2000);
      }
    } catch (error) {
      if (error instanceof Error) {
        setPublishError(error.message);
      } else {
        setPublishError('Failed to publish course. Please try again.');
      }
    } finally {
      setIsPublishing(false);
    }
  };

  const captureTeeLocation = async () => {
    setTeeGpsLoading(true);
    setTeeGpsError(null);
    try {
      const location = await captureLocationWithFallback();
      setTeeAccuracy(location.accuracy);
      setCurrentHole({
        ...currentHole,
        teeLocation: { lat: location.lat, lng: location.lng },
      });
    } catch (error: any) {
      setTeeGpsError(error.message || 'Failed to capture GPS');
    } finally {
      setTeeGpsLoading(false);
    }
  };

  const capturePinLocation = async () => {
    setPinGpsLoading(true);
    setPinGpsError(null);
    try {
      const location = await captureLocationWithFallback();
      setPinAccuracy(location.accuracy);
      setCurrentHole({
        ...currentHole,
        pinLocation: { lat: location.lat, lng: location.lng },
      });
    } catch (error: any) {
      setPinGpsError(error.message || 'Failed to capture GPS');
    } finally {
      setPinGpsLoading(false);
    }
  };

  const captureEditTeeLoc = async () => {
    setEditTeeGpsLoading(true);
    setEditTeeGpsError(null);
    try {
      const location = await captureLocationWithFallback();
      setEditTeeAccuracy(location.accuracy);
      setEditingHoleData({
        ...editingHoleData,
        teeLocation: { lat: location.lat, lng: location.lng },
      });
    } catch (error: any) {
      setEditTeeGpsError(error.message || 'Failed to capture GPS');
    } finally {
      setEditTeeGpsLoading(false);
    }
  };

  const captureEditPinLoc = async () => {
    setEditPinGpsLoading(true);
    setEditPinGpsError(null);
    try {
      const location = await captureLocationWithFallback();
      setEditPinAccuracy(location.accuracy);
      setEditingHoleData({
        ...editingHoleData,
        pinLocation: { lat: location.lat, lng: location.lng },
      });
    } catch (error: any) {
      setEditPinGpsError(error.message || 'Failed to capture GPS');
    } finally {
      setEditPinGpsLoading(false);
    }
  };

  // Manual location input handlers (for testing on desktop)
  const handleManualTeeLoc = (lat: number, lng: number) => {
    setCurrentHole({
      ...currentHole,
      teeLocation: { lat, lng },
    });
    setTeeAccuracy(undefined);
    setManualLocationOpen(null);
  };

  const handleManualPinLoc = (lat: number, lng: number) => {
    setCurrentHole({
      ...currentHole,
      pinLocation: { lat, lng },
    });
    setPinAccuracy(undefined);
    setManualLocationOpen(null);
  };

  const handleManualEditTeeLoc = (lat: number, lng: number) => {
    setEditingHoleData({
      ...editingHoleData,
      teeLocation: { lat, lng },
    });
    setEditTeeAccuracy(undefined);
    setManualLocationOpen(null);
  };

  const handleManualEditPinLoc = (lat: number, lng: number) => {
    setEditingHoleData({
      ...editingHoleData,
      pinLocation: { lat, lng },
    });
    setEditPinAccuracy(undefined);
    setManualLocationOpen(null);
  };

  // Clear location handlers
  const handleClearTeeLoc = () => {
    setCurrentHole({
      ...currentHole,
      teeLocation: undefined,
    });
    setTeeAccuracy(undefined);
  };

  const handleClearPinLoc = () => {
    setCurrentHole({
      ...currentHole,
      pinLocation: undefined,
    });
    setPinAccuracy(undefined);
  };

  const handleClearEditTeeLoc = () => {
    setEditingHoleData({
      ...editingHoleData,
      teeLocation: undefined,
    });
    setEditTeeAccuracy(undefined);
  };

  const handleClearEditPinLoc = () => {
    setEditingHoleData({
      ...editingHoleData,
      pinLocation: undefined,
    });
    setEditPinAccuracy(undefined);
  };

  const handleTeePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentUser) return;

    const validation = validateImageFile(file);
    if (validation) {
      setTeePhotoError(validation);
      return;
    }

    setTeePhotoLoading(true);
    setTeePhotoError(null);

    try {
      const url = await uploadImage(
        file,
        currentUser.uid,
        'preview',
        'tee'
      );
      setCurrentHole({ ...currentHole, teeImage: url });
    } catch (error: any) {
      setTeePhotoError(error.message || 'Failed to upload photo');
    } finally {
      setTeePhotoLoading(false);
      setTeePhotoMenuOpen(false);
      if (teeFileInputRef.current) {
        teeFileInputRef.current.value = '';
      }
    }
  };

  const handlePinPhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentUser) return;

    const validation = validateImageFile(file);
    if (validation) {
      setPinPhotoError(validation);
      return;
    }

    setPinPhotoLoading(true);
    setPinPhotoError(null);

    try {
      const url = await uploadImage(
        file,
        currentUser.uid,
        'preview',
        'pin'
      );
      setCurrentHole({ ...currentHole, pinImage: url });
    } catch (error: any) {
      setPinPhotoError(error.message || 'Failed to upload photo');
    } finally {
      setPinPhotoLoading(false);
      setPinPhotoMenuOpen(false);
      if (pinFileInputRef.current) {
        pinFileInputRef.current.value = '';
      }
    }
  };

  const handleTeeCameraCapture = async (blob: Blob) => {
    if (!currentUser) return;

    setTeePhotoLoading(true);
    setTeePhotoError(null);
    setTeeCameraOpen(false);

    try {
      const file = new File([blob], 'tee-photo.jpg', { type: 'image/jpeg' });
      const url = await uploadImage(
        file,
        currentUser.uid,
        'preview',
        'tee'
      );
      setCurrentHole({ ...currentHole, teeImage: url });
    } catch (error: any) {
      setTeePhotoError(error.message || 'Failed to upload photo');
    } finally {
      setTeePhotoLoading(false);
      setTeePhotoMenuOpen(false);
    }
  };

  const handlePinCameraCapture = async (blob: Blob) => {
    if (!currentUser) return;

    setPinPhotoLoading(true);
    setPinPhotoError(null);
    setPinCameraOpen(false);

    try {
      const file = new File([blob], 'pin-photo.jpg', { type: 'image/jpeg' });
      const url = await uploadImage(
        file,
        currentUser.uid,
        'preview',
        'pin'
      );
      setCurrentHole({ ...currentHole, pinImage: url });
    } catch (error: any) {
      setPinPhotoError(error.message || 'Failed to upload photo');
    } finally {
      setPinPhotoLoading(false);
      setPinPhotoMenuOpen(false);
    }
  };

  const handleEditTeePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentUser || !editingHoleData) return;

    const validation = validateImageFile(file);
    if (validation) {
      setEditTeePhotoError(validation);
      return;
    }

    setEditTeePhotoLoading(true);
    setEditTeePhotoError(null);

    try {
      const url = await uploadImage(file, currentUser.uid, 'preview', 'tee');
      setEditingHoleData({ ...editingHoleData, teeImage: url });
    } catch (error: any) {
      setEditTeePhotoError(error.message || 'Failed to upload photo');
    } finally {
      setEditTeePhotoLoading(false);
      setEditTeePhotoMenuOpen(false);
      if (editTeeFileInputRef.current) {
        editTeeFileInputRef.current.value = '';
      }
    }
  };

  const handleEditPinPhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentUser || !editingHoleData) return;

    const validation = validateImageFile(file);
    if (validation) {
      setEditPinPhotoError(validation);
      return;
    }

    setEditPinPhotoLoading(true);
    setEditPinPhotoError(null);

    try {
      const url = await uploadImage(file, currentUser.uid, 'preview', 'pin');
      setEditingHoleData({ ...editingHoleData, pinImage: url });
    } catch (error: any) {
      setEditPinPhotoError(error.message || 'Failed to upload photo');
    } finally {
      setEditPinPhotoLoading(false);
      setEditPinPhotoMenuOpen(false);
      if (editPinFileInputRef.current) {
        editPinFileInputRef.current.value = '';
      }
    }
  };

  const handleEditTeeCameraCapture = async (blob: Blob) => {
    if (!currentUser || !editingHoleData) return;

    setEditTeePhotoLoading(true);
    setEditTeePhotoError(null);
    setEditTeeCameraOpen(false);

    try {
      const file = new File([blob], 'tee-photo.jpg', { type: 'image/jpeg' });
      const url = await uploadImage(file, currentUser.uid, 'preview', 'tee');
      setEditingHoleData({ ...editingHoleData, teeImage: url });
    } catch (error: any) {
      setEditTeePhotoError(error.message || 'Failed to upload photo');
    } finally {
      setEditTeePhotoLoading(false);
    }
  };

  const handleEditPinCameraCapture = async (blob: Blob) => {
    if (!currentUser || !editingHoleData) return;

    setEditPinPhotoLoading(true);
    setEditPinPhotoError(null);
    setEditPinCameraOpen(false);

    try {
      const file = new File([blob], 'pin-photo.jpg', { type: 'image/jpeg' });
      const url = await uploadImage(file, currentUser.uid, 'preview', 'pin');
      setEditingHoleData({ ...editingHoleData, pinImage: url });
    } catch (error: any) {
      setEditPinPhotoError(error.message || 'Failed to upload photo');
    } finally {
      setEditPinPhotoLoading(false);
    }
  };

  const handleCourseHeaderImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validation = validateImageFile(file);
    if (validation) {
      setCourseHeaderImageError(validation);
      return;
    }

    setCourseHeaderImageLoading(true);
    setCourseHeaderImageError(null);

    try {
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result as string;
        setCourseHeaderImage(result);
      };
      reader.readAsDataURL(file);
    } catch (error: any) {
      setCourseHeaderImageError(error.message || 'Failed to load image');
    } finally {
      setCourseHeaderImageLoading(false);
      setCourseHeaderImageMenuOpen(false);
      if (courseHeaderImageFileInputRef.current) {
        courseHeaderImageFileInputRef.current.value = '';
      }
    }
  };

  const handleCourseHeaderImageCapture = async (blob: Blob) => {
    setCourseHeaderImageLoading(true);
    setCourseHeaderImageError(null);
    setCourseHeaderImageCameraOpen(false);

    try {
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result as string;
        setCourseHeaderImage(result);
      };
      reader.readAsDataURL(blob);
    } catch (error: any) {
      setCourseHeaderImageError(error.message || 'Failed to capture image');
    } finally {
      setCourseHeaderImageLoading(false);
    }
  };

  const canAddHole = currentHole.name && currentHole.teeLocation && currentHole.pinLocation;

  return (
    <div className="h-full flex flex-col bg-dark">
      {/* Header */}
      <div className="bg-gradient-to-b from-navy to-dark p-6 border-b border-white/10 flex-shrink-0">
        <h2 className="text-3xl font-black text-lime mb-1">BUILD YOUR COURSE</h2>
        <p className="text-white/60 text-sm">Create a custom street golf course</p>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-4 space-y-6 pb-32">
        {/* Course Info Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-sm"
        >
          <h3 className="text-white font-bold mb-4 flex items-center gap-2">
            COURSE INFORMATION
          </h3>
          
          <div className="space-y-3">
            <div>
              <label className="text-white/70 text-xs font-bold uppercase tracking-wider mb-2 block">Course Name</label>
              <input
                type="text"
                value={courseName}
                onChange={(e) => setCourseName(e.target.value)}
                placeholder="e.g., Downtown District Open"
                className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white placeholder-white/40 focus:outline-none focus:border-lime/50 focus:bg-white/15 transition"
              />
            </div>

            <div>
              <label className="text-white/70 text-xs font-bold uppercase tracking-wider mb-2 block">Visibility</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setCourseVisibility('public')}
                  className={`flex-1 px-4 py-2 rounded-lg font-bold text-sm transition ${
                    courseVisibility === 'public'
                      ? 'bg-lime text-dark'
                      : 'bg-white/10 text-white hover:bg-white/20 border border-white/20'
                  }`}
                >
                  🌍 Public
                </button>
                <button
                  onClick={() => setCourseVisibility('private')}
                  className={`flex-1 px-4 py-2 rounded-lg font-bold text-sm transition ${
                    courseVisibility === 'private'
                      ? 'bg-lime text-dark'
                      : 'bg-white/10 text-white hover:bg-white/20 border border-white/20'
                  }`}
                >
                  🔒 Private
                </button>
              </div>
              <p className="text-white/50 text-xs mt-1">
                {courseVisibility === 'public'
                  ? 'Anyone can discover this course in the app'
                  : 'Only accessible via a direct link (e.g., ?c=course-id)'}
              </p>
            </div>

            <div>
              <label className="text-white/70 text-xs font-bold uppercase tracking-wider mb-2 block">Course Header Image</label>
              <div className="relative">
                <div className="w-full aspect-video bg-white/5 border border-white/20 rounded-lg overflow-hidden flex items-center justify-center">
                  {courseHeaderImage ? (
                    <img 
                      src={courseHeaderImage.startsWith('data:') ? courseHeaderImage : getImagePath(courseHeaderImage)} 
                      alt="Course header" 
                      className="w-full h-full object-cover" 
                    />
                  ) : (
                    <div className="text-center">
                      <ImageIcon className="w-12 h-12 text-white/30 mx-auto mb-2" />
                      <p className="text-white/40 text-sm">No image selected</p>
                    </div>
                  )}
                </div>

                <div className="flex gap-2 mt-3">
                  <div className="relative flex-1">
                    <button
                      onClick={() => setCourseHeaderImageMenuOpen(!courseHeaderImageMenuOpen)}
                      disabled={courseHeaderImageLoading}
                      className="w-full px-4 py-2 bg-lime text-dark font-bold rounded-lg hover:bg-lime/90 disabled:bg-lime/50 transition flex items-center justify-center gap-2"
                    >
                      <ImageIcon size={18} />
                      {courseHeaderImageLoading ? 'Uploading...' : 'Add Image'}
                    </button>

                    {courseHeaderImageMenuOpen && (
                      <div className="absolute bottom-full left-0 right-0 mb-2 bg-white/10 border border-white/20 rounded-lg overflow-hidden z-10">
                        <button
                          onClick={() => {
                            setCourseHeaderImageCameraOpen(true);
                            setCourseHeaderImageMenuOpen(false);
                          }}
                          className="w-full px-4 py-2 text-white hover:bg-white/10 transition text-left text-sm"
                        >
                          Take Photo
                        </button>
                        <button
                          onClick={() => {
                            courseHeaderImageFileInputRef.current?.click();
                            setCourseHeaderImageMenuOpen(false);
                          }}
                          className="w-full px-4 py-2 text-white hover:bg-white/10 transition text-left text-sm border-t border-white/10"
                        >
                          Choose from Gallery
                        </button>
                      </div>
                    )}
                  </div>

                  {courseHeaderImage && (
                    <button
                      onClick={() => setCourseHeaderImage(null)}
                      className="px-4 py-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition"
                    >
                      <X size={18} />
                    </button>
                  )}
                </div>

                {courseHeaderImageError && (
                  <div className="mt-2 p-2 bg-red-500/20 border border-red-500/30 rounded text-red-200 text-sm flex items-center gap-2">
                    <AlertCircle size={16} />
                    {courseHeaderImageError}
                  </div>
                )}
              </div>

              <input
                ref={courseHeaderImageCameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleCourseHeaderImageSelect}
              />
              <input
                ref={courseHeaderImageFileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleCourseHeaderImageSelect}
              />
            </div>
          </div>
        </motion.div>

        {/* Holes List - appears above Add Hole form when holes exist */}
        <AnimatePresence>
          {holes.length > 0 && (
            <motion.div
              ref={holesListRef}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="space-y-3"
            >
              <h3 className="text-white font-bold mb-4 flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-lime text-dark flex items-center justify-center text-xs font-black">1</div>
                COURSE HOLES ({holes.length})
              </h3>

              {holes.map((hole, idx) => (
                <motion.div
                  key={hole.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="bg-white/5 border border-white/10 rounded-xl p-4 backdrop-blur-sm cursor-pointer hover:border-lime/30 hover:bg-white/10 transition"
                  onClick={() => {
                    if (expandedHole === hole.id) {
                      // Already expanded, close it
                      setExpandedHole(null);
                      setEditingHoleId(null);
                      setEditingHoleData(null);
                    } else {
                      // Not expanded, open it in edit mode
                      editHole(hole);
                    }
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1">
                      <div className="w-8 h-8 rounded-full bg-lime/20 text-lime flex items-center justify-center font-black text-sm">
                        {idx + 1}
                      </div>
                      <div className="flex-1">
                        <h4 className="text-white font-bold">{hole.name}</h4>
                        <p className="text-white/50 text-sm">Par {hole.par} {hole.hazard && '• Hazard'}</p>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeHole(hole.id);
                      }}
                      className="p-2 hover:bg-red-500/20 rounded-lg text-white/50 hover:text-red-400 transition"
                      title="Delete hole"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>

                  {/* Expanded Details or Edit Form */}
                  <AnimatePresence>
                    {expandedHole === hole.id && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mt-4 pt-4 border-t border-white/10 space-y-4 text-sm"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {/* Edit mode form */}
                        <div className="space-y-4">
                          {/* Hole Name & Par */}
                          <div className="grid grid-cols-3 gap-3">
                            <div className="col-span-2">
                              <label className="text-white/70 text-xs font-bold uppercase tracking-wider mb-2 block">Hole Name</label>
                              <input
                                type="text"
                                value={editingHoleData?.name || ''}
                                onChange={(e) => editingHoleData && setEditingHoleData({ ...editingHoleData, name: e.target.value })}
                                placeholder="e.g., Main Street Marker"
                                className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white placeholder-white/40 focus:outline-none focus:border-lime/50 focus:bg-white/15 transition text-sm"
                              />
                            </div>
                            <div>
                              <label className="text-white/70 text-xs font-bold uppercase tracking-wider mb-2 block">Par</label>
                              <select
                                value={editingHoleData?.par || 3}
                                onChange={(e) => editingHoleData && setEditingHoleData({ ...editingHoleData, par: parseInt(e.target.value) })}
                                className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-lime/50 focus:bg-white/15 transition text-sm"
                              >
                                <option value={3}>Par 3</option>
                                <option value={4}>Par 4</option>
                                <option value={5}>Par 5</option>
                              </select>
                            </div>
                          </div>

                            {/* TEE SECTION */}
                            <div className="bg-white/5 border border-white/10 rounded-lg p-4 space-y-3">
                              <h4 className="text-white/80 text-xs font-bold uppercase tracking-wider">Tee Location</h4>
                              
                              {/* Drop Tee & Add Photo Tee */}
                              <div className="grid grid-cols-2 gap-3">
                                <button
                                  onClick={() => {
                                    if (editingHoleData.teeLocation) {
                                      setLocationModalOpen('editTee');
                                    } else {
                                      captureEditTeeLoc();
                                    }
                                  }}
                                  disabled={editTeeCpsLoading}
                                  className={`group bg-gradient-to-b border rounded-lg p-3 transition ${
                                    editingHoleData.teeLocation
                                      ? 'from-lime/20 to-lime/10 border-lime/50 hover:border-lime/70'
                                      : 'from-white/10 to-white/5 border-white/20 hover:border-lime/50 disabled:border-white/10 disabled:opacity-60 disabled:hover:bg-white/5'
                                  } hover:bg-white/15`}
                                >
                                  <div className="flex items-center justify-center gap-2 text-white/70 group-hover:text-lime group-disabled:text-white/50 transition">
                                    {editTeeCpsLoading ? (
                                      <Loader size={18} className="animate-spin" />
                                    ) : (
                                      <MapPin size={18} />
                                    )}
                                    <div className="text-left">
                                      {editingHoleData.teeLocation ? (
                                        <>
                                          <div className="text-xs font-bold text-lime">✓ TEE LOCATION</div>
                                          <div className="text-xs text-lime/80 mt-0.5">
                                            {editingHoleData.teeLocation.lat.toFixed(4)}, {editingHoleData.teeLocation.lng.toFixed(4)}
                                          </div>
                                        </>
                                      ) : editTeeCpsLoading ? (
                                        <>
                                          <div className="text-xs font-bold uppercase tracking-wider">Acquiring...</div>
                                          <div className="text-xs text-white/50">GPS signal</div>
                                        </>
                                      ) : editTeeGpsError ? (
                                        <>
                                          <div className="text-xs font-bold uppercase tracking-wider text-red-400">Error</div>
                                          <div className="text-xs text-red-400/70">{editTeeGpsError}</div>
                                          <div className="flex gap-2 mt-0.5">
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                captureEditTeeLoc();
                                              }}
                                              className="text-xs text-red-400/60 hover:text-red-400/80"
                                            >
                                              Retry
                                            </button>
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setManualLocationOpen('editTee');
                                              }}
                                              className="text-xs text-lime/60 hover:text-lime/80"
                                            >
                                              Enter Manually
                                            </button>
                                          </div>
                                        </>
                                      ) : (
                                        <>
                                          <div className="text-xs font-bold uppercase tracking-wider">Drop Tee</div>
                                          <div className="text-xs text-white/50">Location</div>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                </button>

                                <div className="relative">
                                  <button
                                    onClick={() => setEditTeePhotoMenuOpen(!editTeePhotoMenuOpen)}
                                    disabled={editTeePhotoLoading}
                                    className={`group w-full border rounded-lg overflow-hidden transition ${
                                      editingHoleData.teeImage
                                        ? 'border-lime/50 hover:border-lime/70'
                                        : 'from-white/10 to-white/5 border-white/20 hover:border-lime/50 disabled:border-white/10 disabled:opacity-60'
                                    }`}
                                  >
                                    {editingHoleData.teeImage ? (
                                      <div className="relative h-24 bg-black/50">
                                        <img
                                          src={editingHoleData.teeImage.startsWith('data:') ? editingHoleData.teeImage : getImagePath(editingHoleData.teeImage)}
                                          alt="Tee"
                                          className="w-full h-full object-cover"
                                        />
                                        <div className="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition flex items-center justify-center">
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setEditingHoleData({ ...editingHoleData, teeImage: null });
                                            }}
                                            className="text-lime text-sm font-bold hover:text-lime/70"
                                          >
                                            Change
                                          </button>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="p-3 bg-gradient-to-b from-white/10 to-white/5">
                                        <div className="flex items-center justify-center gap-2 text-white/70 group-hover:text-lime group-disabled:text-white/50 transition">
                                          {editTeePhotoLoading ? (
                                            <Loader size={18} className="animate-spin" />
                                          ) : (
                                            <ImageIcon size={18} />
                                          )}
                                          <div className="text-left">
                                            {editTeePhotoLoading ? (
                                              <>
                                                <div className="text-xs font-bold uppercase tracking-wider">Uploading...</div>
                                                <div className="text-xs text-white/50">Photo</div>
                                              </>
                                            ) : editTeePhotoError ? (
                                              <>
                                                <div className="text-xs font-bold uppercase tracking-wider text-red-400">Error</div>
                                                <button
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    setEditTeePhotoError(null);
                                                  }}
                                                  className="text-xs text-red-400/60 hover:text-red-400/80 mt-0.5"
                                                >
                                                  Retry
                                                </button>
                                              </>
                                            ) : (
                                              <>
                                                <div className="text-xs font-bold uppercase tracking-wider">Add Photo</div>
                                                <div className="text-xs text-white/50">Tee</div>
                                              </>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    )}
                                  </button>

                                  {/* Photo Menu */}
                                  <AnimatePresence>
                                    {editTeePhotoMenuOpen && (
                                      <motion.div
                                        initial={{ opacity: 0, y: -10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -10 }}
                                        className="absolute bottom-full left-0 right-0 mb-2 bg-navy border border-white/20 rounded-lg overflow-hidden shadow-lg z-50"
                                      >
                                        <button
                                          onClick={() => {
                                            setEditTeeCameraOpen(true);
                                            setEditTeePhotoMenuOpen(false);
                                          }}
                                          className="w-full px-4 py-3 text-white hover:bg-white/10 transition text-sm font-semibold flex items-center gap-2 border-b border-white/10"
                                        >
                                          📷 Take Photo
                                        </button>
                                        <button
                                          onClick={() => {
                                            editTeeFileInputRef.current?.click();
                                            setEditTeePhotoMenuOpen(false);
                                          }}
                                          className="w-full px-4 py-3 text-white hover:bg-white/10 transition text-sm font-semibold flex items-center gap-2"
                                        >
                                          📁 Choose File
                                        </button>
                                      </motion.div>
                                    )}
                                  </AnimatePresence>
                                </div>

                                <input
                                  ref={editTeeCameraInputRef}
                                  type="file"
                                  accept="image/*"
                                  capture="environment"
                                  onChange={handleEditTeePhotoSelect}
                                  className="hidden"
                                />
                                <input
                                  ref={editTeeFileInputRef}
                                  type="file"
                                  accept="image/*"
                                  onChange={handleEditTeePhotoSelect}
                                  className="hidden"
                                />
                              </div>

                              {/* Tee Photo Error */}
                              {editTeePhotoError && (
                                <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                                  <AlertCircle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
                                  <div className="text-sm text-red-400">{editTeePhotoError}</div>
                                </div>
                              )}

                              {/* Tee Description */}
                              <div>
                                <label className="text-white/70 text-xs font-bold uppercase tracking-wider mb-2 block">Tee Description</label>
                                <textarea
                                  value={editingHoleData.teeDescription || ''}
                                  onChange={(e) => setEditingHoleData({ ...editingHoleData, teeDescription: e.target.value })}
                                  placeholder="Describe the tee location..."
                                  rows={2}
                                  className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white placeholder-white/40 focus:outline-none focus:border-lime/50 focus:bg-white/15 transition text-sm resize-none"
                                />
                              </div>
                            </div>

                            {/* PIN SECTION */}
                            <div className="bg-white/5 border border-white/10 rounded-lg p-4 space-y-3">
                              <h4 className="text-white/80 text-xs font-bold uppercase tracking-wider">Pin Location</h4>
                              
                              {/* Drop Pin & Add Photo Pin */}
                              <div className="grid grid-cols-2 gap-3">
                                <button
                                  onClick={() => {
                                    if (editingHoleData.pinLocation) {
                                      setLocationModalOpen('editPin');
                                    } else {
                                      captureEditPinLoc();
                                    }
                                  }}
                                  disabled={editPinGpsLoading}
                                  className={`group bg-gradient-to-b border rounded-lg p-3 transition ${
                                    editingHoleData.pinLocation
                                      ? 'from-lime/20 to-lime/10 border-lime/50 hover:border-lime/70'
                                      : 'from-white/10 to-white/5 border-white/20 hover:border-lime/50 disabled:border-white/10 disabled:opacity-60 disabled:hover:bg-white/5'
                                  } hover:bg-white/15`}
                                >
                                  <div className="flex items-center justify-center gap-2 text-white/70 group-hover:text-lime group-disabled:text-white/50 transition">
                                    {editPinGpsLoading ? (
                                      <Loader size={18} className="animate-spin" />
                                    ) : (
                                      <MapPin size={18} />
                                    )}
                                    <div className="text-left">
                                      {editingHoleData.pinLocation ? (
                                        <>
                                          <div className="text-xs font-bold text-lime">✓ PIN LOCATION</div>
                                          <div className="text-xs text-lime/80 mt-0.5">
                                            {editingHoleData.pinLocation.lat.toFixed(4)}, {editingHoleData.pinLocation.lng.toFixed(4)}
                                          </div>
                                        </>
                                      ) : editPinGpsLoading ? (
                                        <>
                                          <div className="text-xs font-bold uppercase tracking-wider">Acquiring...</div>
                                          <div className="text-xs text-white/50">GPS signal</div>
                                        </>
                                      ) : editPinGpsError ? (
                                        <>
                                          <div className="text-xs font-bold uppercase tracking-wider text-red-400">Error</div>
                                          <div className="text-xs text-red-400/70">{editPinGpsError}</div>
                                          <div className="flex gap-2 mt-0.5">
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                captureEditPinLoc();
                                              }}
                                              className="text-xs text-red-400/60 hover:text-red-400/80"
                                            >
                                              Retry
                                            </button>
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setManualLocationOpen('editPin');
                                              }}
                                              className="text-xs text-lime/60 hover:text-lime/80"
                                            >
                                              Enter Manually
                                            </button>
                                          </div>
                                        </>
                                      ) : (
                                        <>
                                          <div className="text-xs font-bold uppercase tracking-wider">Drop Pin</div>
                                          <div className="text-xs text-white/50">Location</div>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                </button>

                                <div className="relative">
                                  <button
                                    onClick={() => setEditPinPhotoMenuOpen(!editPinPhotoMenuOpen)}
                                    disabled={editPinPhotoLoading}
                                    className={`group w-full border rounded-lg overflow-hidden transition ${
                                      editingHoleData.pinImage
                                        ? 'border-lime/50 hover:border-lime/70'
                                        : 'from-white/10 to-white/5 border-white/20 hover:border-lime/50 disabled:border-white/10 disabled:opacity-60'
                                    }`}
                                  >
                                    {editingHoleData.pinImage ? (
                                      <div className="relative h-24 bg-black/50">
                                        <img
                                          src={editingHoleData.pinImage.startsWith('data:') ? editingHoleData.pinImage : getImagePath(editingHoleData.pinImage)}
                                          alt="Pin"
                                          className="w-full h-full object-cover"
                                        />
                                        <div className="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition flex items-center justify-center">
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setEditingHoleData({ ...editingHoleData, pinImage: null });
                                            }}
                                            className="text-lime text-sm font-bold hover:text-lime/70"
                                          >
                                            Change
                                          </button>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="p-3 bg-gradient-to-b from-white/10 to-white/5">
                                        <div className="flex items-center justify-center gap-2 text-white/70 group-hover:text-lime group-disabled:text-white/50 transition">
                                          {editPinPhotoLoading ? (
                                            <Loader size={18} className="animate-spin" />
                                          ) : (
                                            <ImageIcon size={18} />
                                          )}
                                          <div className="text-left">
                                            {editPinPhotoLoading ? (
                                              <>
                                                <div className="text-xs font-bold uppercase tracking-wider">Uploading...</div>
                                                <div className="text-xs text-white/50">Photo</div>
                                              </>
                                            ) : editPinPhotoError ? (
                                              <>
                                                <div className="text-xs font-bold uppercase tracking-wider text-red-400">Error</div>
                                                <button
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    setEditPinPhotoError(null);
                                                  }}
                                                  className="text-xs text-red-400/60 hover:text-red-400/80 mt-0.5"
                                                >
                                                  Retry
                                                </button>
                                              </>
                                            ) : (
                                              <>
                                                <div className="text-xs font-bold uppercase tracking-wider">Add Photo</div>
                                                <div className="text-xs text-white/50">Pin</div>
                                              </>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    )}
                                  </button>

                                  {/* Photo Menu */}
                                  <AnimatePresence>
                                    {editPinPhotoMenuOpen && (
                                      <motion.div
                                        initial={{ opacity: 0, y: -10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -10 }}
                                        className="absolute bottom-full left-0 right-0 mb-2 bg-navy border border-white/20 rounded-lg overflow-hidden shadow-lg z-50"
                                      >
                                        <button
                                          onClick={() => {
                                            setEditPinCameraOpen(true);
                                            setEditPinPhotoMenuOpen(false);
                                          }}
                                          className="w-full px-4 py-3 text-white hover:bg-white/10 transition text-sm font-semibold flex items-center gap-2 border-b border-white/10"
                                        >
                                          📷 Take Photo
                                        </button>
                                        <button
                                          onClick={() => {
                                            editPinFileInputRef.current?.click();
                                            setEditPinPhotoMenuOpen(false);
                                          }}
                                          className="w-full px-4 py-3 text-white hover:bg-white/10 transition text-sm font-semibold flex items-center gap-2"
                                        >
                                          📁 Choose File
                                        </button>
                                      </motion.div>
                                    )}
                                  </AnimatePresence>
                                </div>

                                <input
                                  ref={editPinCameraInputRef}
                                  type="file"
                                  accept="image/*"
                                  capture="environment"
                                  onChange={handleEditPinPhotoSelect}
                                  className="hidden"
                                />
                                <input
                                  ref={editPinFileInputRef}
                                  type="file"
                                  accept="image/*"
                                  onChange={handleEditPinPhotoSelect}
                                  className="hidden"
                                />
                              </div>

                              {/* Pin Photo Error */}
                              {editPinPhotoError && (
                                <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                                  <AlertCircle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
                                  <div className="text-sm text-red-400">{editPinPhotoError}</div>
                                </div>
                              )}

                              {/* Pin Description */}
                              <div>
                                <label className="text-white/70 text-xs font-bold uppercase tracking-wider mb-2 block">Pin Description</label>
                                <textarea
                                  value={editingHoleData.pinDescription || ''}
                                  onChange={(e) => setEditingHoleData({ ...editingHoleData, pinDescription: e.target.value })}
                                  placeholder="Describe the pin location..."
                                  rows={2}
                                  className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white placeholder-white/40 focus:outline-none focus:border-lime/50 focus:bg-white/15 transition text-sm resize-none"
                                />
                              </div>
                            </div>

                            {/* Tips & Hazard */}
                            <div className="space-y-3">
                              <div>
                                <label className="text-white/70 text-xs font-bold uppercase tracking-wider mb-2 block">Tips</label>
                                <textarea
                                  value={editingHoleData.tip || ''}
                                  onChange={(e) => setEditingHoleData({ ...editingHoleData, tip: e.target.value })}
                                  placeholder="Add tips for playing this hole..."
                                  rows={2}
                                  className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white placeholder-white/40 focus:outline-none focus:border-lime/50 focus:bg-white/15 transition text-sm resize-none"
                                />
                              </div>
                              <div className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  id={`hazard-edit-${hole.id}`}
                                  checked={editingHoleData.hazard === true}
                                  onChange={(e) => setEditingHoleData({ ...editingHoleData, hazard: e.target.checked })}
                                  className="w-4 h-4 accent-lime"
                                />
                                <label htmlFor={`hazard-edit-${hole.id}`} className="text-white/80 text-xs font-bold uppercase">Mark as Hazard</label>
                              </div>
                            </div>

                            {/* Save/Cancel Buttons */}
                            <div className="flex gap-2">
                              <button
                                onClick={saveHoleEdit}
                                className="flex-1 px-3 py-2 bg-lime text-dark font-bold text-xs rounded-lg hover:bg-lime/90 transition"
                              >
                                Save
                              </button>
                              <button
                                onClick={cancelHoleEdit}
                                className="flex-1 px-3 py-2 bg-white/10 text-white font-bold text-xs rounded-lg hover:bg-white/20 transition"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-sm"
        >
          <h3 className="text-white font-bold mb-4 flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-lime text-dark flex items-center justify-center text-xs font-black">{holes.length + 1}</div>
            ADD HOLE {holes.length > 0 && <span className="text-lime ml-auto text-sm">({holes.length})</span>}
          </h3>

          <div className="space-y-4">
            {/* Hole Name & Par */}
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="text-white/70 text-xs font-bold uppercase tracking-wider mb-2 block">Hole Name</label>
                <input
                  type="text"
                  value={currentHole.name || ''}
                  onChange={(e) => setCurrentHole({ ...currentHole, name: e.target.value })}
                  placeholder="e.g., Main Street Marker"
                  className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white placeholder-white/40 focus:outline-none focus:border-lime/50 focus:bg-white/15 transition"
                />
              </div>
              <div>
                <label className="text-white/70 text-xs font-bold uppercase tracking-wider mb-2 block">Par</label>
                <select
                  value={currentHole.par || 3}
                  onChange={(e) => setCurrentHole({ ...currentHole, par: parseInt(e.target.value) })}
                  className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-lime/50 focus:bg-white/15 transition"
                >
                  <option value={3}>Par 3</option>
                  <option value={4}>Par 4</option>
                  <option value={5}>Par 5</option>
                </select>
              </div>
            </div>

            {/* TEE SECTION */}
            <div className="bg-white/5 border border-white/10 rounded-lg p-4 space-y-3">
              <h4 className="text-white/80 text-xs font-bold uppercase tracking-wider">Tee Location</h4>
              
              {/* Drop Tee & Add Photo Tee */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => {
                    if (currentHole.teeLocation) {
                      setLocationModalOpen('tee');
                    } else {
                      captureTeeLocation();
                    }
                  }}
                  disabled={teeGpsLoading}
                  className={`group bg-gradient-to-b border rounded-lg p-3 transition ${
                    currentHole.teeLocation
                      ? 'from-lime/20 to-lime/10 border-lime/50 hover:border-lime/70'
                      : 'from-white/10 to-white/5 border-white/20 hover:border-lime/50 disabled:border-white/10 disabled:opacity-60 disabled:hover:bg-white/5'
                  } hover:bg-white/15`}
                >
                  <div className="flex items-center justify-center gap-2 text-white/70 group-hover:text-lime group-disabled:text-white/50 transition">
                    {teeGpsLoading ? (
                      <Loader size={18} className="animate-spin" />
                    ) : (
                      <MapPin size={18} />
                    )}
                    <div className="text-left">
                      {currentHole.teeLocation ? (
                        <>
                          <div className="text-xs font-bold text-lime">✓ TEE LOCATION</div>
                          <div className="text-xs text-lime/80 mt-0.5">
                            {currentHole.teeLocation.lat.toFixed(4)}, {currentHole.teeLocation.lng.toFixed(4)}
                          </div>
                        </>
                      ) : teeGpsLoading ? (
                        <>
                          <div className="text-xs font-bold uppercase tracking-wider">Acquiring...</div>
                          <div className="text-xs text-white/50">GPS signal</div>
                        </>
                      ) : teeGpsError ? (
                        <>
                          <div className="text-xs font-bold uppercase tracking-wider text-red-400">Error</div>
                          <div className="text-xs text-red-400/70">{teeGpsError}</div>
                          <div className="flex gap-2 mt-0.5">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                captureTeeLocation();
                              }}
                              className="text-xs text-red-400/60 hover:text-red-400/80"
                            >
                              Retry
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setManualLocationOpen('tee');
                              }}
                              className="text-xs text-lime/60 hover:text-lime/80"
                            >
                              Enter Manually
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="text-xs font-bold uppercase tracking-wider">Drop Tee</div>
                          <div className="text-xs text-white/50">Location</div>
                        </>
                      )}
                    </div>
                  </div>
                </button>

                <div className="relative">
                  <button
                    onClick={() => setTeePhotoMenuOpen(!teePhotoMenuOpen)}
                    disabled={teePhotoLoading}
                    className={`group w-full border rounded-lg overflow-hidden transition ${
                      currentHole.teeImage
                        ? 'border-lime/50 hover:border-lime/70'
                        : 'from-white/10 to-white/5 border-white/20 hover:border-lime/50 disabled:border-white/10 disabled:opacity-60'
                    }`}
                  >
                    {currentHole.teeImage ? (
                      <div className="relative h-24 bg-black/50">
                        <img
                          src={currentHole.teeImage}
                          alt="Tee"
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition flex items-center justify-center">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setCurrentHole({ ...currentHole, teeImage: null });
                            }}
                            className="text-lime text-sm font-bold hover:text-lime/70"
                          >
                            Change
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="p-3 bg-gradient-to-b from-white/10 to-white/5">
                        <div className="flex items-center justify-center gap-2 text-white/70 group-hover:text-lime group-disabled:text-white/50 transition">
                          {teePhotoLoading ? (
                            <Loader size={18} className="animate-spin" />
                          ) : (
                            <ImageIcon size={18} />
                          )}
                          <div className="text-left">
                            {teePhotoLoading ? (
                              <>
                                <div className="text-xs font-bold uppercase tracking-wider">Uploading...</div>
                                <div className="text-xs text-white/50">Photo</div>
                              </>
                            ) : teePhotoError ? (
                              <>
                                <div className="text-xs font-bold uppercase tracking-wider text-red-400">Error</div>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setTeePhotoError(null);
                                  }}
                                  className="text-xs text-red-400/60 hover:text-red-400/80 mt-0.5"
                                >
                                  Retry
                                </button>
                              </>
                            ) : (
                              <>
                                <div className="text-xs font-bold uppercase tracking-wider">Add Photo</div>
                                <div className="text-xs text-white/50">Tee</div>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </button>

                  {/* Photo Menu */}
                  <AnimatePresence>
                    {teePhotoMenuOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="absolute bottom-full left-0 right-0 mb-2 bg-navy border border-white/20 rounded-lg overflow-hidden shadow-lg z-50"
                      >
                        <button
                          onClick={() => {
                            setTeeCameraOpen(true);
                            setTeePhotoMenuOpen(false);
                          }}
                          className="w-full px-4 py-3 text-white hover:bg-white/10 transition text-sm font-semibold flex items-center gap-2 border-b border-white/10"
                        >
                          📷 Take Photo
                        </button>
                        <button
                          onClick={() => {
                            teeFileInputRef.current?.click();
                            setTeePhotoMenuOpen(false);
                          }}
                          className="w-full px-4 py-3 text-white hover:bg-white/10 transition text-sm font-semibold flex items-center gap-2"
                        >
                          📁 Choose File
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <input
                  ref={teeCameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleTeePhotoSelect}
                  className="hidden"
                />
                <input
                  ref={teeFileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleTeePhotoSelect}
                  className="hidden"
                />
              </div>

              {/* Tee Photo Error */}
              {teePhotoError && (
                <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                  <AlertCircle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-red-400">{teePhotoError}</div>
                </div>
              )}

              {/* Tee Description */}
              <div>
                <label className="text-white/70 text-xs font-bold uppercase tracking-wider mb-2 block">Tee Description</label>
                <textarea
                  value={currentHole.teeDescription || ''}
                  onChange={(e) => setCurrentHole({ ...currentHole, teeDescription: e.target.value })}
                  placeholder="Describe the tee location..."
                  rows={2}
                  className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white placeholder-white/40 focus:outline-none focus:border-lime/50 focus:bg-white/15 transition text-sm resize-none"
                />
              </div>
            </div>

            {/* PIN SECTION */}
            <div className="bg-white/5 border border-white/10 rounded-lg p-4 space-y-3">
              <h4 className="text-white/80 text-xs font-bold uppercase tracking-wider">Pin Location</h4>
              
              {/* Drop Pin & Add Photo Pin */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => {
                    if (currentHole.pinLocation) {
                      setLocationModalOpen('pin');
                    } else {
                      capturePinLocation();
                    }
                  }}
                  disabled={pinGpsLoading}
                  className={`group bg-gradient-to-b border rounded-lg p-3 transition ${
                    currentHole.pinLocation
                      ? 'from-lime/20 to-lime/10 border-lime/50 hover:border-lime/70'
                      : 'from-white/10 to-white/5 border-white/20 hover:border-lime/50 disabled:border-white/10 disabled:opacity-60 disabled:hover:bg-white/5'
                  } hover:bg-white/15`}
                >
                  <div className="flex items-center justify-center gap-2 text-white/70 group-hover:text-lime group-disabled:text-white/50 transition">
                    {pinGpsLoading ? (
                      <Loader size={18} className="animate-spin" />
                    ) : (
                      <MapPin size={18} />
                    )}
                    <div className="text-left">
                      {currentHole.pinLocation ? (
                        <>
                          <div className="text-xs font-bold text-lime">✓ PIN LOCATION</div>
                          <div className="text-xs text-lime/80 mt-0.5">
                            {currentHole.pinLocation.lat.toFixed(4)}, {currentHole.pinLocation.lng.toFixed(4)}
                          </div>
                        </>
                      ) : pinGpsLoading ? (
                        <>
                          <div className="text-xs font-bold uppercase tracking-wider">Acquiring...</div>
                          <div className="text-xs text-white/50">GPS signal</div>
                        </>
                      ) : pinGpsError ? (
                        <>
                          <div className="text-xs font-bold uppercase tracking-wider text-red-400">Error</div>
                          <div className="text-xs text-red-400/70">{pinGpsError}</div>
                          <div className="flex gap-2 mt-0.5">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                capturePinLocation();
                              }}
                              className="text-xs text-red-400/60 hover:text-red-400/80"
                            >
                              Retry
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setManualLocationOpen('pin');
                              }}
                              className="text-xs text-lime/60 hover:text-lime/80"
                            >
                              Enter Manually
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="text-xs font-bold uppercase tracking-wider">Drop Pin</div>
                          <div className="text-xs text-white/50">Location</div>
                        </>
                      )}
                    </div>
                  </div>
                </button>

                <div className="relative">
                  <button
                    onClick={() => setPinPhotoMenuOpen(!pinPhotoMenuOpen)}
                    disabled={pinPhotoLoading}
                    className={`group w-full border rounded-lg overflow-hidden transition ${
                      currentHole.pinImage
                        ? 'border-lime/50 hover:border-lime/70'
                        : 'from-white/10 to-white/5 border-white/20 hover:border-lime/50 disabled:border-white/10 disabled:opacity-60'
                    }`}
                  >
                    {currentHole.pinImage ? (
                      <div className="relative h-24 bg-black/50">
                        <img
                          src={currentHole.pinImage}
                          alt="Pin"
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition flex items-center justify-center">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setCurrentHole({ ...currentHole, pinImage: null });
                            }}
                            className="text-lime text-sm font-bold hover:text-lime/70"
                          >
                            Change
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="p-3 bg-gradient-to-b from-white/10 to-white/5">
                        <div className="flex items-center justify-center gap-2 text-white/70 group-hover:text-lime group-disabled:text-white/50 transition">
                          {pinPhotoLoading ? (
                            <Loader size={18} className="animate-spin" />
                          ) : (
                            <ImageIcon size={18} />
                          )}
                          <div className="text-left">
                            {pinPhotoLoading ? (
                              <>
                                <div className="text-xs font-bold uppercase tracking-wider">Uploading...</div>
                                <div className="text-xs text-white/50">Photo</div>
                              </>
                            ) : pinPhotoError ? (
                              <>
                                <div className="text-xs font-bold uppercase tracking-wider text-red-400">Error</div>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setPinPhotoError(null);
                                  }}
                                  className="text-xs text-red-400/60 hover:text-red-400/80 mt-0.5"
                                >
                                  Retry
                                </button>
                              </>
                            ) : (
                              <>
                                <div className="text-xs font-bold uppercase tracking-wider">Add Photo</div>
                                <div className="text-xs text-white/50">Pin</div>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </button>

                  {/* Photo Menu */}
                  <AnimatePresence>
                    {pinPhotoMenuOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="absolute bottom-full left-0 right-0 mb-2 bg-navy border border-white/20 rounded-lg overflow-hidden shadow-lg z-50"
                      >
                        <button
                          onClick={() => {
                            setPinCameraOpen(true);
                            setPinPhotoMenuOpen(false);
                          }}
                          className="w-full px-4 py-3 text-white hover:bg-white/10 transition text-sm font-semibold flex items-center gap-2 border-b border-white/10"
                        >
                          📷 Take Photo
                        </button>
                        <button
                          onClick={() => {
                            pinFileInputRef.current?.click();
                            setPinPhotoMenuOpen(false);
                          }}
                          className="w-full px-4 py-3 text-white hover:bg-white/10 transition text-sm font-semibold flex items-center gap-2"
                        >
                          📁 Choose File
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <input
                  ref={pinCameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handlePinPhotoSelect}
                  className="hidden"
                />
                <input
                  ref={pinFileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handlePinPhotoSelect}
                  className="hidden"
                />
              </div>

              {/* Pin Photo Error */}
              {pinPhotoError && (
                <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                  <AlertCircle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-red-400">{pinPhotoError}</div>
                </div>
              )}

              {/* Pin Description */}
              <div>
                <label className="text-white/70 text-xs font-bold uppercase tracking-wider mb-2 block">Pin Description</label>
                <textarea
                  value={currentHole.pinDescription || ''}
                  onChange={(e) => setCurrentHole({ ...currentHole, pinDescription: e.target.value })}
                  placeholder="Describe the pin/target location..."
                  rows={2}
                  className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white placeholder-white/40 focus:outline-none focus:border-lime/50 focus:bg-white/15 transition text-sm resize-none"
                />
              </div>
            </div>

            {/* INFO SECTION */}
            <div className="bg-white/5 border border-white/10 rounded-lg p-4 space-y-3">
              <h4 className="text-white/80 text-xs font-bold uppercase tracking-wider">Additional Info</h4>
              
              <div>
                <label className="text-white/70 text-xs font-bold uppercase tracking-wider mb-2 block">Course Tips</label>
                <textarea
                  value={currentHole.tip || ''}
                  onChange={(e) => setCurrentHole({ ...currentHole, tip: e.target.value })}
                  placeholder="Any advice for playing this hole? (distance, obstacles, etc.)"
                  rows={2}
                  className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white placeholder-white/40 focus:outline-none focus:border-lime/50 focus:bg-white/15 transition text-sm resize-none"
                />
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="hazard"
                  checked={currentHole.hazard || false}
                  onChange={(e) => setCurrentHole({ ...currentHole, hazard: e.target.checked })}
                  className="w-5 h-5 accent-lime rounded cursor-pointer"
                />
                <label htmlFor="hazard" className="text-white/80 font-semibold cursor-pointer flex items-center gap-2">
                  <AlertCircle size={16} className="text-orange-400" />
                  Mark as Hazard
                </label>
              </div>
            </div>

            {/* Add Hole Button */}
            <button
              onClick={addHole}
              disabled={!canAddHole}
              className={`w-full py-3 rounded-xl font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition ${
                canAddHole
                  ? 'bg-lime text-dark hover:bg-lime/90 shadow-lg shadow-lime/20 cursor-pointer'
                  : 'bg-white/10 text-white/40 cursor-not-allowed'
              }`}
            >
              <Plus size={18} />
              Add Hole
            </button>
          </div>
        </motion.div>

        {/* Publish Error */}
        {publishError && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4"
          >
            <AlertCircle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-red-400">{publishError}</div>
          </motion.div>
        )}

        {/* Publish Success */}
        {publishSuccess && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-2 bg-lime/10 border border-lime/30 rounded-lg p-3 mb-4"
          >
            <div className="text-sm text-lime font-bold">✓ Course published successfully!</div>
          </motion.div>
        )}

        {/* Publish/Update Buttons */}
        {holes.length > 0 && (
          <div className="flex gap-3">
            {editingCourse && onCancel && (
              <motion.button
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                onClick={onCancel}
                className="flex-1 py-4 rounded-xl font-black text-lg shadow-xl uppercase tracking-wider transition bg-white/10 text-white hover:bg-white/20 border border-white/20"
              >
                <ChevronLeft size={20} className="inline mr-2" />
                Cancel
              </motion.button>
            )}
            <motion.button
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              onClick={publishCourse}
              disabled={isPublishing}
              className={`flex-1 py-4 rounded-xl font-black text-sm shadow-xl uppercase tracking-wider transition ${
                isPublishing
                  ? 'bg-lime/50 text-dark/50 shadow-lime/10 cursor-not-allowed'
                  : 'bg-gradient-to-r from-lime to-lime/80 text-dark hover:shadow-lime/40 shadow-lime/20 cursor-pointer'
              }`}
            >
              {isPublishing ? (
                <div className="flex items-center justify-center gap-2">
                  <Loader size={20} className="animate-spin" />
                  {editingCourse ? 'Updating...' : 'Publishing...'}
                </div>
              ) : (
                <>
                  {editingCourse ? 'Update Course' : `Publish Course (${holes.length} ${holes.length === 1 ? 'Hole' : 'Holes'})`}
                </>
              )}
            </motion.button>
          </div>
        )}

        {/* Empty State */}
        {holes.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="text-center py-8 text-white/50"
          >
            <p className="text-sm">Add your first hole to get started</p>
          </motion.div>
        )}
      </div>
      </div>

      {/* Camera Modals */}
      <AnimatePresence>
        {teeCameraOpen && (
          <CameraCapture
            location="tee"
            onCapture={handleTeeCameraCapture}
            onCancel={() => setTeeCameraOpen(false)}
          />
        )}
        {pinCameraOpen && (
          <CameraCapture
            location="pin"
            onCapture={handlePinCameraCapture}
            onCancel={() => setPinCameraOpen(false)}
          />
        )}
        {courseHeaderImageCameraOpen && (
          <CameraCapture
            location="course"
            onCapture={handleCourseHeaderImageCapture}
            onCancel={() => setCourseHeaderImageCameraOpen(false)}
          />
        )}
        {editTeeCameraOpen && (
          <CameraCapture
            location="tee"
            onCapture={handleEditTeeCameraCapture}
            onCancel={() => setEditTeeCameraOpen(false)}
          />
        )}
        {editPinCameraOpen && (
          <CameraCapture
            location="pin"
            onCapture={handleEditPinCameraCapture}
            onCancel={() => setEditPinCameraOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Location Verification Modals */}
      <AnimatePresence>
        {locationModalOpen === 'tee' && currentHole.teeLocation && (
          <LocationVerificationModal
            isOpen={locationModalOpen === 'tee'}
            onClose={() => setLocationModalOpen(null)}
            onClear={handleClearTeeLoc}
            location={currentHole.teeLocation}
            locationName="Tee Location"
            accuracy={teeAccuracy}
          />
        )}
        {locationModalOpen === 'pin' && currentHole.pinLocation && (
          <LocationVerificationModal
            isOpen={locationModalOpen === 'pin'}
            onClose={() => setLocationModalOpen(null)}
            onClear={handleClearPinLoc}
            location={currentHole.pinLocation}
            locationName="Pin Location"
            accuracy={pinAccuracy}
          />
        )}
        {locationModalOpen === 'editTee' && editingHoleData.teeLocation && (
          <LocationVerificationModal
            isOpen={locationModalOpen === 'editTee'}
            onClose={() => setLocationModalOpen(null)}
            onClear={handleClearEditTeeLoc}
            location={editingHoleData.teeLocation}
            locationName="Tee Location"
            accuracy={editTeeAccuracy}
          />
        )}
        {locationModalOpen === 'editPin' && editingHoleData.pinLocation && (
          <LocationVerificationModal
            isOpen={locationModalOpen === 'editPin'}
            onClose={() => setLocationModalOpen(null)}
            onClear={handleClearEditPinLoc}
            location={editingHoleData.pinLocation}
            locationName="Pin Location"
            accuracy={editPinAccuracy}
          />
        )}
      </AnimatePresence>

      {/* Manual Location Input Modals (for testing on desktop) */}
      <AnimatePresence>
        {manualLocationOpen === 'tee' && (
          <ManualLocationInput
            isOpen={manualLocationOpen === 'tee'}
            onClose={() => setManualLocationOpen(null)}
            onSubmit={handleManualTeeLoc}
            initialLocation={currentHole.teeLocation || undefined}
          />
        )}
        {manualLocationOpen === 'pin' && (
          <ManualLocationInput
            isOpen={manualLocationOpen === 'pin'}
            onClose={() => setManualLocationOpen(null)}
            onSubmit={handleManualPinLoc}
            initialLocation={currentHole.pinLocation || undefined}
          />
        )}
        {manualLocationOpen === 'editTee' && (
          <ManualLocationInput
            isOpen={manualLocationOpen === 'editTee'}
            onClose={() => setManualLocationOpen(null)}
            onSubmit={handleManualEditTeeLoc}
            initialLocation={editingHoleData.teeLocation || undefined}
          />
        )}
        {manualLocationOpen === 'editPin' && (
          <ManualLocationInput
            isOpen={manualLocationOpen === 'editPin'}
            onClose={() => setManualLocationOpen(null)}
            onSubmit={handleManualEditPinLoc}
            initialLocation={editingHoleData.pinLocation || undefined}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
