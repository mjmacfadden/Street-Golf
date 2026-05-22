export interface GPSLocation {
  lat: number;
  lng: number;
  accuracy: number;
  timestamp: number;
}

export interface GeolocationError {
  code: 'PERMISSION_DENIED' | 'POSITION_UNAVAILABLE' | 'TIMEOUT' | 'UNKNOWN';
  message: string;
}

/**
 * Capture GPS location using browser Geolocation API with continuous monitoring for best accuracy
 * @param timeout - Maximum time to wait for GPS lock in milliseconds (default: 30s on desktop, 60s on mobile)
 * @param targetAccuracy - Target accuracy in meters (default: 10m for good accuracy)
 * @returns Promise with GPS coordinates or error
 */
export const captureGPSLocation = (
  timeout?: number,
  targetAccuracy: number = 10
): Promise<GPSLocation> => {
  // Detect if likely mobile or desktop - mobile user agents typically have "Mobile" in them
  const isMobile = /Mobile|Android|iPhone|iPad|iPod/.test(navigator.userAgent);
  const defaultTimeout = isMobile ? 60000 : 5000; // 5s on desktop (WiFi-based), 60s on mobile (GPS)
  const finalTimeout = timeout ?? defaultTimeout;

  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject({
        code: 'UNKNOWN',
        message: 'Geolocation is not supported by your browser',
      } as GeolocationError);
      return;
    }

    let bestReading: GPSLocation | null = null;
    let timeoutId: NodeJS.Timeout;
    let watchId: number | null = null;
    let hasReceivedCallback = false;

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    };

    timeoutId = setTimeout(() => {
      cleanup();
      if (bestReading) {
        // If we have at least one reading, use it even if accuracy isn't perfect
        resolve(bestReading);
      } else {
        // More specific error message for desktop
        reject({
          code: 'TIMEOUT',
          message: !isMobile 
            ? 'Desktop GPS not available. Mobile devices have better GPS accuracy. For testing, use browser DevTools to simulate location.' 
            : 'GPS acquisition timed out. Please try again in an open area.',
        } as GeolocationError);
      }
    }, finalTimeout);

    // Use watchPosition to get continuous updates and find the best reading
    watchId = navigator.geolocation.watchPosition(
      (position) => {
        hasReceivedCallback = true;
        const newReading: GPSLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: position.timestamp,
        };

        // Keep track of the best reading (smallest accuracy value)
        if (!bestReading || newReading.accuracy < bestReading.accuracy) {
          bestReading = newReading;

          // If we've achieved good accuracy, resolve immediately
          if (newReading.accuracy <= targetAccuracy) {
            cleanup();
            resolve(bestReading);
          }
        }
      },
      (error) => {
        cleanup();
        let code: GeolocationError['code'] = 'UNKNOWN';
        let message = 'Unknown error acquiring GPS location';

        switch (error.code) {
          case error.PERMISSION_DENIED:
            code = 'PERMISSION_DENIED';
            message =
              'GPS permission denied. Please enable location access in your browser settings.';
            break;
          case error.POSITION_UNAVAILABLE:
            code = 'POSITION_UNAVAILABLE';
            message =
              'GPS position unavailable. Try moving to an open area or checking your GPS settings.';
            break;
          case error.TIMEOUT:
            code = 'TIMEOUT';
            message =
              'GPS acquisition timed out. Please try again in an open area.';
            break;
        }

        reject({
          code,
          message,
        } as GeolocationError);
      },
      {
        enableHighAccuracy: true,
        timeout: finalTimeout, // Use computed timeout for mobile (60s) vs desktop (5s)
        maximumAge: 0, // Always get fresh position, never use cached
      }
    );
  });
};

/**
 * Format accuracy for display
 * @param accuracy - Accuracy in meters
 * @returns Formatted string
 */
export const formatAccuracy = (accuracy: number): string => {
  if (accuracy < 1) return '< 1m';
  if (accuracy < 10) return `${Math.round(accuracy)}m`;
  if (accuracy < 100) return `${Math.round(accuracy / 5) * 5}m`;
  return `${Math.round(accuracy / 10) * 10}m`;
};

/**
 * Check if accuracy is good enough
 * @param accuracy - Accuracy in meters
 * @returns True if accuracy is acceptable (< 15m for good precision)
 */
export const isAccuracyGood = (accuracy: number): boolean => {
  return accuracy < 15;
};

/**
 * Capture GPS location with real-time accuracy feedback
 * Useful for UI that shows current accuracy while acquiring location
 * @param options - Configuration options
 * @returns Promise with GPS coordinates or error
 */
export const captureGPSLocationWithFeedback = (options: {
  timeout?: number;
  targetAccuracy?: number;
  onAccuracyUpdate?: (accuracy: number, attempts: number) => void;
}): Promise<GPSLocation> => {
  const timeout = options.timeout ?? 60000;
  const targetAccuracy = options.targetAccuracy ?? 10;
  const onAccuracyUpdate = options.onAccuracyUpdate;

  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject({
        code: 'UNKNOWN',
        message: 'Geolocation is not supported by your browser',
      } as GeolocationError);
      return;
    }

    let bestReading: GPSLocation | null = null;
    let attemptCount = 0;
    let timeoutId: NodeJS.Timeout;
    let watchId: number | null = null;

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    };

    timeoutId = setTimeout(() => {
      cleanup();
      if (bestReading) {
        resolve(bestReading);
      } else {
        reject({
          code: 'TIMEOUT',
          message: 'GPS acquisition timed out. Please try again in an open area.',
        } as GeolocationError);
      }
    }, timeout);

    watchId = navigator.geolocation.watchPosition(
      (position) => {
        attemptCount++;
        const newReading: GPSLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: position.timestamp,
        };

        if (!bestReading || newReading.accuracy < bestReading.accuracy) {
          bestReading = newReading;
          if (onAccuracyUpdate) {
            onAccuracyUpdate(newReading.accuracy, attemptCount);
          }

          if (newReading.accuracy <= targetAccuracy) {
            cleanup();
            resolve(bestReading);
          }
        }
      },
      (error) => {
        cleanup();
        let code: GeolocationError['code'] = 'UNKNOWN';
        let message = 'Unknown error acquiring GPS location';

        switch (error.code) {
          case error.PERMISSION_DENIED:
            code = 'PERMISSION_DENIED';
            message =
              'GPS permission denied. Please enable location access in your browser settings.';
            break;
          case error.POSITION_UNAVAILABLE:
            code = 'POSITION_UNAVAILABLE';
            message =
              'GPS position unavailable. Try moving to an open area or checking your GPS settings.';
            break;
          case error.TIMEOUT:
            code = 'TIMEOUT';
            message =
              'GPS acquisition timed out. Please try again in an open area.';
            break;
        }

        reject({
          code,
          message,
        } as GeolocationError);
      },
      {
        enableHighAccuracy: true,
        timeout: timeout, // Timeout already set at function level
        maximumAge: 0, // Always get fresh position, never use cached
      }
    );
  });
};

/**
 * Get approximate location using IP address (very fast, ~100ms, but less accurate)
 * Useful as fallback on desktop when GPS/WiFi not available
 * @returns Promise with approximate coordinates or error
 */
export const captureLocationByIP = (): Promise<GPSLocation> => {
  return fetch('https://ipapi.co/json/')
    .then((response) => response.json())
    .then((data) => {
      if (data.latitude && data.longitude) {
        return {
          lat: data.latitude,
          lng: data.longitude,
          accuracy: 5000, // IP-based accuracy is typically 1-5km, use 5km as estimate
          timestamp: Date.now(),
        } as GPSLocation;
      }
      throw new Error('Invalid IP geolocation response');
    })
    .catch((error) => {
      throw {
        code: 'POSITION_UNAVAILABLE',
        message: 'Unable to determine location from IP address',
      } as GeolocationError;
    });
};

/**
 * Capture location with intelligent fallbacks for desktop
 * On desktop: Tries WiFi-based geolocation (5s), then IP-based geolocation
 * On mobile: Uses GPS with continuous monitoring
 * @returns Promise with coordinates or error
 */
export const captureLocationWithFallback = async (): Promise<GPSLocation> => {
  const isMobile = /Mobile|Android|iPhone|iPad|iPod/.test(navigator.userAgent);

  // On mobile, use standard GPS capture
  if (isMobile) {
    return captureGPSLocation();
  }

  // On desktop, try WiFi-based geolocation first (5s timeout), then fallback to IP
  try {
    return await captureGPSLocation(5000, 10);
  } catch (gpsError) {
    // GPS/WiFi failed, try IP-based geolocation as quick fallback
    try {
      return await captureLocationByIP();
    } catch (ipError) {
      // Both failed, return the original GPS error
      throw gpsError;
    }
  }
};
