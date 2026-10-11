import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { ModsView } from '@mc/common';
import { modsApi } from '@/api/mods.api';
import { describeModsError, type ApiError } from './mods-errors';

export interface UploadState { file: File; progress: number }

/** File d'envoi séquentielle : un fichier à la fois, progression, annulation, proposition de remplacement. */
export function useModUpload(onDone: (view: ModsView) => void) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState<UploadState | null>(null);
  const [pendingReplace, setPendingReplace] = useState<File | null>(null);
  const queue = useRef<{ file: File; replace: boolean }[]>([]);
  const running = useRef(false);
  const controller = useRef<AbortController | null>(null);

  const run = async () => {
    const next = queue.current.shift();
    if (!next) { running.current = false; setCurrent(null); return; }
    running.current = true;
    controller.current = new AbortController();
    setCurrent({ file: next.file, progress: 0 });
    try {
      const view = await modsApi.upload(next.file, { replace: next.replace, signal: controller.current.signal, onProgress: (p) => setCurrent({ file: next.file, progress: p }) });
      onDone(view);
      toast.success(t('mods.upload.done'));
    } catch (err) {
      const e = err as ApiError & { code?: string };
      const code = e.response?.data?.code;
      if (e.code === 'ERR_CANCELED') { /* annulé par l'utilisateur */ }
      else if (!next.replace && (code === 'exists' || (code === 'duplicate_mod' && e.response?.data?.details === next.file.name))) setPendingReplace(next.file);
      else toast.error(describeModsError(e, t));
    }
    void run();
  };
  const start = (file: File, replace = false) => { queue.current.push({ file, replace }); if (!running.current) void run(); };
  const cancel = () => controller.current?.abort();
  const confirmReplace = () => { const f = pendingReplace; setPendingReplace(null); if (f) start(f, true); };
  const dismissReplace = () => setPendingReplace(null);
  return { current, start, cancel, pendingReplace, confirmReplace, dismissReplace };
}
