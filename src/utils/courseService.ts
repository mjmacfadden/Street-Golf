import { db, storage } from '../config/firebase';
import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  Timestamp,
  deleteDoc,
} from 'firebase/firestore';
import { ref, deleteObject } from 'firebase/storage';
import type { Round } from '../types';

export interface CourseHole {
  id: string;
  name: string;
  par: number;
  teeLocation: { lat: number; lng: number };
  pinLocation: { lat: number; lng: number };
  teeDescription: string;
  pinDescription: string;
  teeImage: string | null; // Firebase Storage URL
  pinImage: string | null; // Firebase Storage URL
  tip: string;
  hazard: boolean;
}

export interface Course {
  id: string;
  userId: string;
  courseName: string;
  description?: string; // New: course description
  creatorName?: string;
  headerImage?: string | null;
  holes: CourseHole[];
  status: 'draft' | 'published';
  visibility?: 'public' | 'private'; // 'public' = appears in index, 'private' = hidden but shareable via URL
  averageRating?: number; // New: average rating (1-5)
  totalRatings?: number; // New: total number of ratings
  createdAt: Date;
  updatedAt: Date;
  publishedAt?: Date;
}

/**
 * Save a course (draft or published)
 * @param userId - Current user ID
 * @param course - Course data without ID
 * @returns Course ID
 */
export const saveCourse = async (
  userId: string,
  course: Omit<Course, 'id' | 'userId' | 'createdAt' | 'updatedAt' | 'publishedAt'>
): Promise<string> => {
  try {
    // Validate course
    if (!course.courseName.trim()) {
      throw new Error('Course name is required');
    }

    if (course.holes.length === 0) {
      throw new Error('Course must have at least one hole');
    }

    // Validate all holes have required fields
    for (const hole of course.holes) {
      if (!hole.name.trim()) {
        throw new Error(`Hole ${hole.id} is missing a name`);
      }
      if (!hole.teeLocation) {
        throw new Error(`Hole "${hole.name}" is missing tee location`);
      }
      if (!hole.pinLocation) {
        throw new Error(`Hole "${hole.name}" is missing pin location`);
      }
    }

    // Create course document in user's courses subcollection
    const courseId = doc(collection(db, 'users', userId, 'courses')).id;
    const courseRef = doc(db, 'users', userId, 'courses', courseId);

    // Clean holes - reconstruct each hole with only expected fields to prevent undefined
    const cleanedHoles = course.holes.map(hole => ({
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

    const now = new Date();
    const courseData: any = {
      ...course,
      holes: cleanedHoles,
      id: courseId,
      userId,
      createdAt: Timestamp.fromDate(now),
      updatedAt: Timestamp.fromDate(now),
      ...(course.status === 'published' && {
        publishedAt: Timestamp.fromDate(now),
      }),
    };

    // Remove any undefined values from the entire object
    Object.keys(courseData).forEach(key => {
      if (courseData[key] === undefined) delete courseData[key];
    });

    await setDoc(courseRef, courseData);

    // If publishing, also add to public courses collection (non-blocking)
    if (course.status === 'published') {
      try {
        const publicRef = doc(db, 'courses', courseId);
        await setDoc(publicRef, {
          id: courseId,
          userId,
          creatorUid: userId,
          courseName: course.courseName,
          creatorName: course.creatorName || 'Anonymous',
          holes: course.holes,
          holesCount: course.holes.length,
          headerImage: course.headerImage || null,
          visibility: course.visibility || 'public',
          createdAt: Timestamp.fromDate(now),
          updatedAt: Timestamp.fromDate(now),
          publishedAt: Timestamp.fromDate(now),
          status: 'published',
          // Store first tee and pin images for preview
          previewTeeImage: course.holes[0]?.teeImage || null,
          previewPinImage: course.holes[0]?.pinImage || null,
        });
      } catch (err) {
        console.warn('Failed to add course to public collection (non-blocking):', err);
        // Don't fail the entire operation - course is already saved privately
      }
    }

    return courseId;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to save course: ${error.message}`);
    }
    throw new Error('Failed to save course: Unknown error');
  }
};

/**
 * Publish a draft course (make it public)
 * @param userId - Current user ID
 * @param courseId - Course ID to publish
 * @returns Updated course
 */
export const publishCourse = async (
  userId: string,
  courseId: string,
  visibility: 'public' | 'private' = 'public'
): Promise<Course> => {
  try {
    const courseRef = doc(db, 'users', userId, 'courses', courseId);
    const courseSnap = await getDoc(courseRef);

    if (!courseSnap.exists()) {
      throw new Error('Course not found');
    }

    const course = courseSnap.data() as Course;

    // Check if already published
    if (course.status === 'published') {
      return course;
    }

    // Update status to published
    const now = new Date();
    const publishedData = {
      ...course,
      status: 'published' as const,
      visibility: visibility,
      updatedAt: Timestamp.fromDate(now),
      publishedAt: Timestamp.fromDate(now),
    };

    await setDoc(courseRef, publishedData);

    // Add to public courses collection (non-blocking)
    try {
      const publicRef = doc(db, 'courses', courseId);
      await setDoc(publicRef, {
        id: courseId,
        userId,
        creatorUid: userId,
        courseName: course.courseName,
        creatorName: course.creatorName || 'Anonymous',
        visibility: visibility,
        holesCount: course.holes.length,
        createdAt: course.createdAt,
        publishedAt: Timestamp.fromDate(now),
        previewTeeImage: course.holes[0]?.teeImage || null,
        previewPinImage: course.holes[0]?.pinImage || null,
      });
    } catch (err) {
      console.warn('Failed to add course to public collection (non-blocking):', err);
      // Don't fail the entire operation - course is already updated privately
    }

    return publishedData;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to publish course: ${error.message}`);
    }
    throw new Error('Failed to publish course: Unknown error');
  }
};

/**
 * Update course visibility (public or private)
 * @param userId - User ID (owner)
 * @param courseId - Course ID
 * @param visibility - 'public' (appears in index) or 'private' (hidden but shareable via URL)
 */
export const updateCourseVisibility = async (
  userId: string,
  courseId: string,
  visibility: 'public' | 'private'
): Promise<void> => {
  try {
    // Update in user's courses
    const userCourseRef = doc(db, 'users', userId, 'courses', courseId);
    await setDoc(userCourseRef, { visibility }, { merge: true });

    // Update in public courses collection if published
    const publicRef = doc(db, 'courses', courseId);
    await setDoc(publicRef, { visibility }, { merge: true });
  } catch (error) {
    console.error('Failed to update course visibility:', error);
    throw error;
  }
};

/**
 * Get all courses for a user (drafts and published)
 * @param userId - User ID
 * @returns Array of courses
 */
export const getUserCourses = async (userId: string): Promise<Course[]> => {
  try {
    const q = query(
      collection(db, 'users', userId, 'courses'),
      orderBy('updatedAt', 'desc')
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        ...data,
        id: doc.id,
        createdAt: data.createdAt?.toDate() || new Date(),
        updatedAt: data.updatedAt?.toDate() || new Date(),
        publishedAt: data.publishedAt?.toDate(),
      } as Course;
    });
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to fetch user courses: ${error.message}`);
    }
    throw new Error('Failed to fetch user courses: Unknown error');
  }
};

/**
 * Get all published courses (for discovery)
 * @returns Array of published courses filtered to public visibility
 */
export const getPublishedCourses = async (): Promise<Course[]> => {
  try {
    const q = query(
      collection(db, 'courses'),
      orderBy('publishedAt', 'desc')
    );
    const snapshot = await getDocs(q);
    return snapshot.docs
      .map((doc) => {
        const data = doc.data();
        // Get full course data from user's courses
        return {
          ...data,
          id: doc.id,
          createdAt: data.createdAt?.toDate() || new Date(),
          updatedAt: data.updatedAt?.toDate() || new Date(),
          publishedAt: data.publishedAt?.toDate(),
        } as Course;
      })
      .filter(course => course.visibility !== 'private'); // Filter out private courses
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to fetch published courses: ${error.message}`);
    }
    throw new Error('Failed to fetch published courses: Unknown error');
  }
};

/**
 * Get a course by ID (including private courses for sharing)
 * @param courseId - Course ID
 * @returns Course data or null if not found
 */
export const getCourseById = async (courseId: string): Promise<Course | null> => {
  try {
    const docRef = doc(db, 'courses', courseId);
    const docSnap = await getDoc(docRef);
    
    if (!docSnap.exists()) {
      return null;
    }
    
    const data = docSnap.data();
    return {
      ...data,
      id: docSnap.id,
      createdAt: data.createdAt?.toDate() || new Date(),
      updatedAt: data.updatedAt?.toDate() || new Date(),
      publishedAt: data.publishedAt?.toDate(),
    } as Course;
  } catch (error) {
    console.error(`Failed to fetch course ${courseId}:`, error);
    return null;
  }
}

/**
 * Get a specific course by ID
 * @param userId - User ID (owner)
 * @param courseId - Course ID
 * @returns Course data
 */
export const getCourse = async (
  userId: string,
  courseId: string
): Promise<Course> => {
  try {
    const courseRef = doc(db, 'users', userId, 'courses', courseId);
    const courseSnap = await getDoc(courseRef);

    if (!courseSnap.exists()) {
      throw new Error('Course not found');
    }

    const data = courseSnap.data();
    return {
      ...data,
      id: courseSnap.id,
      createdAt: data.createdAt?.toDate() || new Date(),
      updatedAt: data.updatedAt?.toDate() || new Date(),
      publishedAt: data.publishedAt?.toDate(),
    } as Course;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to fetch course: ${error.message}`);
    }
    throw new Error('Failed to fetch course: Unknown error');
  }
};

/**
 * Delete a course and all associated images
 * @param userId - User ID (owner)
 * @param courseId - Course ID to delete
 */
export const deleteCourse = async (
  userId: string,
  courseId: string
): Promise<void> => {
  try {
    // Get course data first to delete associated images
    const courseRef = doc(db, 'users', userId, 'courses', courseId);
    const courseSnap = await getDoc(courseRef);

    if (courseSnap.exists()) {
      const course = courseSnap.data() as Course;

      // Delete all images from Firebase Storage
      for (const hole of course.holes) {
        if (hole.teeImage) {
          try {
            const teeRef = ref(storage, hole.teeImage);
            await deleteObject(teeRef);
          } catch (err) {
            console.warn('Failed to delete tee image:', err);
          }
        }

        if (hole.pinImage) {
          try {
            const pinRef = ref(storage, hole.pinImage);
            await deleteObject(pinRef);
          } catch (err) {
            console.warn('Failed to delete pin image:', err);
          }
        }
      }
    }

    // Delete the course document
    await deleteDoc(courseRef);

    // Delete from public courses if published
    const publicRef = doc(db, 'courses', courseId);
    try {
      await deleteDoc(publicRef);
    } catch (err) {
      console.warn('Failed to delete public course reference:', err);
    }
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to delete course: ${error.message}`);
    }
    throw new Error('Failed to delete course: Unknown error');
  }
};

/**
 * Save a round for a logged-in user
 * @param userId - User ID (owner)
 * @param round - Round data
 */
export const saveRound = async (userId: string, round: Round): Promise<void> => {
  try {
    const roundRef = doc(db, 'users', userId, 'rounds', round.id);
    const roundData = {
      ...round,
      date: round.date, // Keep as ISO string
      createdAt: Timestamp.now(),
    };
    await setDoc(roundRef, roundData, { merge: true });
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to save round: ${error.message}`);
    }
    throw new Error('Failed to save round: Unknown error');
  }
};

/**
 * Get all rounds for a user
 * @param userId - User ID
 * @returns Array of rounds, sorted by date descending
 */
export const getUserRounds = async (userId: string): Promise<Round[]> => {
  try {
    const roundsRef = collection(db, 'users', userId, 'rounds');
    const q = query(roundsRef, orderBy('date', 'desc'));
    const snapshot = await getDocs(q);

    return snapshot.docs.map(doc => ({
      id: doc.id,
      date: doc.data().date,
      scores: doc.data().scores,
      isCompleted: doc.data().isCompleted,
      courseId: doc.data().courseId,
    })) as Round[];
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to fetch rounds: ${error.message}`);
    }
    throw new Error('Failed to fetch rounds: Unknown error');
  }
};

/**
 * Delete a round
 * @param userId - User ID (owner)
 * @param roundId - Round ID to delete
 */
export const deleteRound = async (userId: string, roundId: string): Promise<void> => {
  try {
    const roundRef = doc(db, 'users', userId, 'rounds', roundId);
    await deleteDoc(roundRef);
    
    // Verify the deletion actually worked
    const verifySnapshot = await getDoc(roundRef);
    if (verifySnapshot.exists()) {
      throw new Error('Deletion verification failed: Round still exists in Firestore after deleteDoc');
    }
    console.log('✅ Deletion verified: Round no longer exists in Firestore');
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to delete round: ${error.message}`);
    }
    throw new Error('Failed to delete round: Unknown error');
  }
};

/**
 * Delete all incomplete rounds for a user
 * This cleans up any stray active rounds
 */
export const deleteAllIncompleteRounds = async (userId: string): Promise<void> => {
  try {
    const roundsRef = collection(db, 'users', userId, 'rounds');
    const q = query(roundsRef, where('isCompleted', '==', false));
    const snapshot = await getDocs(q);
    
    if (snapshot.empty) {
      console.log('✅ No incomplete rounds to clean up');
      return;
    }
    
    console.log(`🗑️ Cleaning up ${snapshot.size} incomplete round(s)...`);
    
    // Delete all incomplete rounds
    const deletePromises = snapshot.docs.map(doc => deleteDoc(doc.ref));
    await Promise.all(deletePromises);
    
    console.log(`✅ Cleaned up ${snapshot.size} incomplete round(s)`);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to clean up incomplete rounds: ${error.message}`);
    }
    throw new Error('Failed to clean up incomplete rounds: Unknown error');
  }
};

/**
 * Add a course to user's favorites
 */
export const addFavorite = async (userId: string, courseId: string): Promise<void> => {
  try {
    const favoriteRef = doc(db, 'users', userId, 'favorites', courseId);
    await setDoc(favoriteRef, {
      courseId,
      addedAt: Timestamp.now(),
    });
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to add favorite: ${error.message}`);
    }
    throw new Error('Failed to add favorite: Unknown error');
  }
};

/**
 * Remove a course from user's favorites
 */
export const removeFavorite = async (userId: string, courseId: string): Promise<void> => {
  try {
    const favoriteRef = doc(db, 'users', userId, 'favorites', courseId);
    await deleteDoc(favoriteRef);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to remove favorite: ${error.message}`);
    }
    throw new Error('Failed to remove favorite: Unknown error');
  }
};

/**
 * Get user's favorite courses
 */
export const getUserFavorites = async (userId: string): Promise<string[]> => {
  try {
    const favoritesQuery = collection(db, 'users', userId, 'favorites');
    const snapshot = await getDocs(favoritesQuery);
    return snapshot.docs.map(doc => doc.id);
  } catch (error) {
    console.warn('Failed to fetch favorites:', error);
    return [];
  }
};

/**
 * ADMIN: Get all courses in the system
 */
export const getAllCourses = async (): Promise<(Course & { creatorName?: string; creatorEmail?: string })[]> => {
  try {
    // Fetch all published courses from /courses collection
    const publishedSnapshot = await getDocs(collection(db, 'courses'));
    const allCourses = new Map<string, Course & { creatorName?: string; creatorEmail?: string }>();
    
    publishedSnapshot.docs.forEach(doc => {
      const data = doc.data();
      allCourses.set(doc.id, {
        ...data,
        id: doc.id,
        createdAt: data.createdAt?.toDate?.() || new Date(),
        updatedAt: data.updatedAt?.toDate?.() || new Date(),
        publishedAt: data.publishedAt?.toDate?.(),
      } as Course & { creatorName?: string; creatorEmail?: string });
    });

    // Try to fetch all user courses to include unpublished ones (admin only)
    try {
      const usersSnapshot = await getDocs(collection(db, 'users'));
      
      for (const userDoc of usersSnapshot.docs) {
        const userId = userDoc.id;
        const userData = userDoc.data();
        
        // Get all courses for this user
        const userCoursesSnapshot = await getDocs(collection(db, 'users', userId, 'courses'));
        
        userCoursesSnapshot.docs.forEach(courseDoc => {
          const courseId = courseDoc.id;
          const data = courseDoc.data();
          
          // Only add if not already in map (published courses take precedence)
          if (!allCourses.has(courseId)) {
            allCourses.set(courseId, {
              ...data,
              id: courseId,
              createdAt: data.createdAt?.toDate?.() || new Date(),
              updatedAt: data.updatedAt?.toDate?.() || new Date(),
              publishedAt: data.publishedAt?.toDate?.(),
              creatorName: userData.displayName,
              creatorEmail: userData.email,
            } as Course & { creatorName?: string; creatorEmail?: string });
          }
        });
      }
    } catch (permissionError: any) {
      // If we don't have permission to read all users, just return published courses
      // This is expected for non-admin users
      if (permissionError?.code === 'permission-denied') {
        console.debug('Admin access not available, returning published courses only');
      } else {
        console.warn('Error fetching unpublished courses:', permissionError);
      }
    }

    const courses = Array.from(allCourses.values());
    return courses.sort((a, b) => (b.createdAt?.getTime?.() || 0) - (a.createdAt?.getTime?.() || 0));
  } catch (error) {
    console.error('Failed to fetch all courses:', error);
    return [];
  }
};

/**
 * ADMIN: Get all users in the system
 */
export interface AdminUser {
  uid: string;
  displayName?: string;
  email?: string;
  courseCount: number;
  createdAt?: Date;
}

export const getAllUsers = async (): Promise<AdminUser[]> => {
  try {
    const usersQuery = collection(db, 'users');
    const snapshot = await getDocs(usersQuery);
    const users: AdminUser[] = [];

    for (const userDoc of snapshot.docs) {
      const uid = userDoc.id;
      const userData = userDoc.data();
      
      // Count user's courses
      let courseCount = 0;
      try {
        const coursesRef = collection(db, 'users', uid, 'courses');
        const coursesSnapshot = await getDocs(coursesRef);
        courseCount = coursesSnapshot.size;
      } catch (courseError: any) {
        // If we can't read this user's courses, set count to 0
        if (courseError?.code === 'permission-denied') {
          console.debug(`No permission to read courses for user ${uid}`);
        } else {
          console.warn(`Failed to fetch courses for user ${uid}:`, courseError);
        }
        courseCount = 0;
      }
      
      users.push({
        uid,
        displayName: userData.displayName,
        email: userData.email,
        courseCount,
        createdAt: userData.createdAt?.toDate?.(),
      });
    }

    return users.sort((a, b) => (b.createdAt?.getTime?.() || 0) - (a.createdAt?.getTime?.() || 0));
  } catch (error: any) {
    console.error('Failed to fetch all users:', error);
    // If we can't read users at all, return empty (requires admin permissions)
    if (error?.code === 'permission-denied') {
      console.debug('Admin access not available for user listing');
    }
    return [];
  }
};

/**
 * ADMIN: Delete a user and all their data
 */
export const deleteUserAndData = async (userId: string): Promise<void> => {
  try {
    // Delete user's courses from /courses collection
    const userCoursesRef = collection(db, 'users', userId, 'courses');
    const coursesSnapshot = await getDocs(userCoursesRef);
    
    for (const courseDoc of coursesSnapshot.docs) {
      const courseId = courseDoc.id;
      // Delete from published courses
      await deleteDoc(doc(db, 'courses', courseId)).catch(() => {});
      // Delete from user's courses
      await deleteDoc(doc(db, 'users', userId, 'courses', courseId)).catch(() => {});
    }

    // Delete user's rounds
    const roundsRef = collection(db, 'users', userId, 'rounds');
    const roundsSnapshot = await getDocs(roundsRef);
    for (const roundDoc of roundsSnapshot.docs) {
      await deleteDoc(doc(db, 'users', userId, 'rounds', roundDoc.id)).catch(() => {});
    }

    // Delete user's favorites
    const favoritesRef = collection(db, 'users', userId, 'favorites');
    const favoritesSnapshot = await getDocs(favoritesRef);
    for (const favDoc of favoritesSnapshot.docs) {
      await deleteDoc(doc(db, 'users', userId, 'favorites', favDoc.id)).catch(() => {});
    }

    // Delete user document
    await deleteDoc(doc(db, 'users', userId)).catch(() => {});
  } catch (error) {
    console.error('Failed to delete user and data:', error);
    throw error;
  }
};

/**
 * ADMIN: Delete a course from the public collection
 */
export const deleteCourseAdmin = async (courseId: string): Promise<void> => {
  try {
    await deleteDoc(doc(db, 'courses', courseId));
  } catch (error) {
    console.error('Failed to delete course:', error);
    throw error;
  }
};

/**
 * ADMIN: Migrate hardcoded courses (Southbridge, Glenbrook) to Firebase
 * under the admin account
 */
export const migrateCourseToFirebase = async (
  adminUid: string,
  courseId: string,
  courseName: string,
  location: string,
  holes: any[]
): Promise<void> => {
  try {
    const courseData = {
      id: courseId,
      userId: adminUid,
      courseName: courseName,
      creatorName: 'Admin',
      location: location,
      holes: holes,
      status: 'published' as const,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      publishedAt: Timestamp.now(),
    };

    // Save to public courses collection
    await setDoc(doc(db, 'courses', courseId), courseData);
    
    // Save to admin's user courses
    await setDoc(doc(db, 'users', adminUid, 'courses', courseId), courseData);
    
    console.log(`✅ Migrated course "${courseName}" to Firebase`);
  } catch (error) {
    console.error(`Failed to migrate course "${courseName}":`, error);
    throw error;
  }
};

/**
 * Rate a course (1-5 stars)
 * @param courseId - The course to rate
 * @param userId - User ID (must be authenticated)
 * @param rating - Rating value (1-5)
 */
export const rateCourse = async (courseId: string, userId: string, rating: number): Promise<void> => {
  try {
    if (rating < 1 || rating > 5) {
      throw new Error('Rating must be between 1 and 5');
    }

    const ratingRef = doc(db, 'courses', courseId, 'ratings', userId);
    await setDoc(ratingRef, {
      rating,
      timestamp: Timestamp.now(),
    });
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to rate course: ${error.message}`);
    }
    throw new Error('Failed to rate course: Unknown error');
  }
};

/**
 * Get user's rating for a course (or undefined if not rated)
 * @param courseId - The course ID
 * @param userId - User ID
 */
export const getUserCourseRating = async (courseId: string, userId: string): Promise<number | undefined> => {
  try {
    const ratingRef = doc(db, 'courses', courseId, 'ratings', userId);
    const ratingDoc = await getDoc(ratingRef);
    return ratingDoc.exists() ? ratingDoc.data().rating : undefined;
  } catch (error) {
    console.warn('Failed to fetch user rating:', error);
    return undefined;
  }
};

/**
 * Get all ratings for a course
 * @param courseId - The course ID
 * @returns Object with averageRating, totalRatings, and individual ratings
 */
export const getCourseRatings = async (courseId: string): Promise<{
  averageRating: number;
  totalRatings: number;
  ratings: Record<string, number>;
}> => {
  try {
    const ratingsRef = collection(db, 'courses', courseId, 'ratings');
    const snapshot = await getDocs(ratingsRef);
    
    const ratings: Record<string, number> = {};
    let totalRating = 0;
    let totalCount = 0;

    snapshot.docs.forEach(doc => {
      const rating = doc.data().rating;
      ratings[doc.id] = rating;
      totalRating += rating;
      totalCount += 1;
    });

    const averageRating = totalCount > 0 ? totalRating / totalCount : 0;

    return {
      averageRating,
      totalRatings: totalCount,
      ratings,
    };
  } catch (error) {
    console.warn('Failed to fetch course ratings:', error);
    return {
      averageRating: 0,
      totalRatings: 0,
      ratings: {},
    };
  }
};
