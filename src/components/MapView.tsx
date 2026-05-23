import { Map, AdvancedMarker, Pin, useMap, useMapsLibrary } from '@vis.gl/react-google-maps';
import { Hole } from '../types';
import { useEffect, useRef, Fragment } from 'react';

interface UserLocation {
  lat: number;
  lng: number;
}

function MapHandler({ holes, currentHoleIndex, userLocation }: { holes: Hole[], currentHoleIndex: number | null, userLocation?: UserLocation }) {
  const map = useMap();
  const mapsLib = useMapsLibrary('maps');
  const courseLinesRef = useRef<google.maps.Polyline[]>([]);

  // Draw course lines
  useEffect(() => {
    if (!map || !mapsLib || holes.length === 0) return;

    // Clear old lines
    courseLinesRef.current.forEach(line => line.setMap(null));
    courseLinesRef.current = [];

    // 1. Draw individual fairway lines (Tee to Pin)
    holes.forEach((hole, idx) => {
      const fairwayLine = new google.maps.Polyline({
        path: [hole.teeLocation, hole.pinLocation],
        geodesic: true,
        strokeColor: '#BFFF00', // lime
        strokeOpacity: currentHoleIndex === idx ? 0.9 : 0.3,
        strokeWeight: currentHoleIndex === idx ? 6 : 2,
        map: map
      });
      courseLinesRef.current.push(fairwayLine);
    });

    // 2. Draw the 'Course Walk' (Pin to next Tee)
    const walkPaths = holes.slice(0, -1).map((hole, idx) => ({
      path: [hole.pinLocation, holes[idx + 1].teeLocation]
    }));

    walkPaths.forEach(walk => {
      const walkLine = new google.maps.Polyline({
        path: walk.path,
        geodesic: true,
        strokeColor: '#FFFFFF', 
        strokeOpacity: 0.2, // Very subtle walk path
        strokeWeight: 1,
        icons: [{
          icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 2 },
          offset: '0',
          repeat: '10px'
        }],
        map: map
      });
      courseLinesRef.current.push(walkLine);
    });

    return () => {
      courseLinesRef.current.forEach(line => line.setMap(null));
    };
  }, [map, mapsLib, holes, currentHoleIndex]);

  // Center on current hole or whole course or user location
  const prevHoleIndexRef = useRef<number | null>(null);
  
  useEffect(() => {
    if (!map || !mapsLib) return;

    console.log('MapView centering effect:', { holesCount: holes.length, currentHoleIndex, userLocation });

    // If no holes but has user location, center on user
    if (holes.length === 0 && userLocation) {
      console.log('✅ Centering on user location:', userLocation);
      map.setCenter(userLocation);
      map.setZoom(17);
      return;
    }

    // If has holes, use course centering logic
    if (holes.length === 0) return;

    if (currentHoleIndex !== null) {
      // Calculate center and zoom for the hole
      const tee = holes[currentHoleIndex].teeLocation;
      const pin = holes[currentHoleIndex].pinLocation;
      const centerLat = (tee.lat + pin.lat) / 2;
      const centerLng = (tee.lng + pin.lng) / 2;
      
      // Only zoom with animation when transitioning from whole course to hole 1
      if (prevHoleIndexRef.current === null && currentHoleIndex === 0) {
        // Animate zoom in from whole course view
        map.setZoom(19);
        setTimeout(() => {
          map.panTo({ lat: centerLat, lng: centerLng });
          map.setZoom(20);
        }, 200);
      } else {
        // For other transitions, smoothly pan and zoom to the hole
        // Use fitBounds with a small buffer for smooth animation
        const bounds = new google.maps.LatLngBounds();
        bounds.extend(tee);
        bounds.extend(pin);
        map.fitBounds(bounds, { top: 100, right: 100, bottom: 100, left: 100 });
      }
    } else {
      // Default view: Show full course at zoom level 15
      map.setCenter(holes[0].teeLocation);
      map.setZoom(18);
    }
    
    prevHoleIndexRef.current = currentHoleIndex;
  }, [map, holes, currentHoleIndex, mapsLib, userLocation]);

  return null;
}

interface MapViewProps {
  holes: Hole[];
  currentHoleIndex: number | null;
  onMarkerClick: (index: number) => void;
  userLocation?: UserLocation;
}

export default function MapView({ holes, currentHoleIndex, onMarkerClick, userLocation }: MapViewProps) {
  return (
    <div className="relative w-full h-full">
      <Map
        defaultCenter={holes[0]?.teeLocation || userLocation || { lat: 42.12060, lng: -87.78430 }}
        defaultZoom={16}
        mapId="DEMO_MAP_ID"
        mapTypeId="satellite"
        disableDefaultUI={true}
        gestureHandling="greedy"
        internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
        style={{ width: '100%', height: '100%' }}
        onClick={(e) => {
          if (e.detail.latLng) {
            console.log(`STREET GOLF COORDS: { lat: ${e.detail.latLng.lat.toFixed(6)}, lng: ${e.detail.latLng.lng.toFixed(6)} }`);
          }
        }}
      >
        <MapHandler holes={holes} currentHoleIndex={currentHoleIndex} userLocation={userLocation} />
        
        {/* User location dot (shown when map view has user location) */}
        {userLocation && (
          <>
            {console.log('🔵 Rendering user location marker at:', userLocation)}
            <AdvancedMarker
              position={userLocation}
              zIndex={100}
            >
              <div style={{
                width: '24px',
                height: '24px',
                backgroundColor: '#BFFF00',
                borderRadius: '50%',
                border: '2px solid white',
                boxShadow: '0 0 15px rgba(191, 255, 0, 0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <div style={{
                  width: '8px',
                  height: '8px',
                  backgroundColor: '#010409',
                  borderRadius: '50%',
                }} />
              </div>
            </AdvancedMarker>
          </>
        )}
        
        {holes.map((hole, idx) => (
          <Fragment key={hole.number}>
            {/* Tee Marker */}
            <AdvancedMarker
              position={hole.teeLocation}
              onClick={() => onMarkerClick(idx)}
              zIndex={currentHoleIndex === idx ? 10 : 1}
            >
              <div className={`p-1.5 rounded-sm border-2 ${currentHoleIndex === idx ? 'bg-white border-lime scale-110 shadow-[0_0_15px_rgba(191,255,0,0.5)]' : 'bg-dark border-white/20 opacity-40'} transition-all`}>
                <p className={`text-[10px] font-black leading-none italic ${currentHoleIndex === idx ? 'text-dark' : 'text-white'}`}>T{hole.number}</p>
              </div>
            </AdvancedMarker>

            {/* Pin Marker */}
            <AdvancedMarker
              position={hole.pinLocation}
              onClick={() => onMarkerClick(idx)}
              zIndex={currentHoleIndex === idx ? 20 : 5}
            >
              <Pin
                background={currentHoleIndex === idx ? '#BFFF00' : '#1e293b'}
                glyphColor={currentHoleIndex === idx ? '#010409' : '#fff'}
                borderColor={'#fff'}
                glyph={hole.number.toString()}
                scale={currentHoleIndex === idx ? 1.2 : 0.8}
              />
            </AdvancedMarker>
          </Fragment>
        ))}
      </Map>
    </div>
  );
}
