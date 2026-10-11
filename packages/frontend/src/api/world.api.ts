import api from './client';
import type { Difficulty, Gamemode, TimePreset, WeatherKind, WorldState, WorldTickUpdate } from '@mc/common';

export const worldApi = {
  get: (): Promise<WorldState> => api.get('/world').then((r) => r.data),
  setTime: (preset: TimePreset): Promise<WorldState> => api.put('/world/time', { preset }).then((r) => r.data),
  setWeather: (kind: WeatherKind): Promise<WorldState> => api.put('/world/weather', { kind }).then((r) => r.data),
  setDifficulty: (difficulty: Difficulty): Promise<WorldState> => api.put('/world/difficulty', { difficulty }).then((r) => r.data),
  setGamemode: (gamemode: Gamemode): Promise<WorldState> => api.put('/world/gamemode', { gamemode }).then((r) => r.data),
  setTick: (update: WorldTickUpdate): Promise<WorldState> => api.put('/world/tick', update).then((r) => r.data),
  setGamerule: (name: string, value: boolean | number): Promise<WorldState> => api.put(`/world/gamerules/${encodeURIComponent(name)}`, { value }).then((r) => r.data),
};
