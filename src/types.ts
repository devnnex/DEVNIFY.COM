export interface User {
  id: string;
  username: string;
  name: string;
  salt: string;
  verifier: string;
  iterations: number;
  avatar?: string;
  createdAt: number;
}
export interface Song {
  id: string;
  ownerId: string;
  title: string;
  artist: string;
  album: string;
  genre: string;
  year?: number;
  duration: number;
  mimeType: string;
  size: number;
  downloaded: boolean;
  artwork?: string;
  sourceType: 'file' | 'direct-url' | 'authorized-import';
  sourceUrl?: string;
  createdAt: number;
  updatedAt: number;
  playCount: number;
  lastPlayedAt?: number;
  checksum: string;
  favorite: boolean;
  bitrate?: number;
}
export interface AudioRecord {
  id: string;
  ownerId: string;
  blob: Blob;
}
export interface Playlist {
  id: string;
  ownerId: string;
  name: string;
  description: string;
  artwork?: string;
  songIds: string[];
  createdAt: number;
}
export interface History {
  id: string;
  ownerId: string;
  songId: string;
  playedAt: number;
  seconds: number;
}
export interface Settings {
  ownerId: string;
  serviceUrl: string;
  serviceToken: string;
  remember: boolean;
  volume: number;
  speed: number;
  eq: number[];
}
export interface QueueState {
  ownerId: string;
  ids: string[];
  currentId?: string;
  position: number;
  shuffle: boolean;
  repeat: 'off' | 'all' | 'one';
}
export type View = 'home' | 'library' | 'search' | 'playlists' | 'settings';
