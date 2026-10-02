import { useSyncExternalStore } from 'react';
import { kunciNavSekarang, langgananKunciNav } from './kunci-nav.ts';

/** Kalimat alasan kunci nav, atau `null` bila bebas. Dipakai setiap jalan keluar header. */
export function usePakaiKunciNav(): string | null {
  return useSyncExternalStore(langgananKunciNav, kunciNavSekarang, kunciNavSekarang);
}
