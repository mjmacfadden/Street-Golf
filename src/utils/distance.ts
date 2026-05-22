/**
 * Haversine formula to calculate distance between two coordinates
 * @param lat1 User latitude
 * @param lon1 User longitude
 * @param lat2 Course latitude
 * @param lon2 Course longitude
 * @returns Distance in miles
 */
export const calculateDistance = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const R = 3959; // Earth's radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

/**
 * Sort courses by distance from user location
 * @param courses Array of courses with hole locations
 * @param userLat User latitude
 * @param userLon User longitude
 * @returns Sorted array of courses with distance property added
 */
export const sortCoursesByDistance = (
  courses: any[],
  userLat: number,
  userLon: number
): (any & { distance?: number })[] => {
  return courses
    .map(course => {
      // Get the first hole's tee location as the course location
      if (course.holes && course.holes[0]?.teeLocation) {
        const { lat, lng } = course.holes[0].teeLocation;
        const distance = calculateDistance(userLat, userLon, lat, lng);
        return { ...course, distance };
      }
      // If no tee location, return with infinite distance (goes to end)
      return { ...course, distance: Infinity };
    })
    .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
};
