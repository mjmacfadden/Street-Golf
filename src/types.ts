export interface Hole {
  number: number;
  name: string;
  teeLocation: google.maps.LatLngLiteral;
  teeDescription: string;
  pinLocation: google.maps.LatLngLiteral;
  pinDescription: string;
  teeImage?: string;
  pinImage?: string;
  par: number;
  tip: string;
  hazard: boolean;
  photoSpot?: string;
}

export interface Score {
  strokes: number;
  putts?: number;
  notes?: string;
}

export interface Player {
  id: string;
  name: string;
  scores: Record<number, Score>;
}

export interface Round {
  id: string;
  date: string;
  scores: Record<number, Score>; // Backward compatibility (single player)
  players?: Player[]; // Multiplayer support
  activePlayerIdx?: number; // Current player index
  isCompleted: boolean;
  courseId?: string;
  courseName?: string;
}
