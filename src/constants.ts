import { Home, Library, Search, ListMusic, Settings as SettingsIcon } from 'lucide-react';
export const navigation = [
  { id: 'home', label: 'Inicio', icon: Home },
  { id: 'library', label: 'Biblioteca', icon: Library },
  { id: 'search', label: 'Buscar', icon: Search },
  { id: 'playlists', label: 'Playlists', icon: ListMusic },
  { id: 'settings', label: 'Ajustes', icon: SettingsIcon },
] as const;
export const filters = [
  ['all', 'Todo'],
  ['new', 'Recién añadidas'],
  ['trending', 'En rotación'],
  ['top', 'Más escuchadas'],
  ['favorites', 'Favoritos'],
  ['downloaded', 'Descargadas'],
];
