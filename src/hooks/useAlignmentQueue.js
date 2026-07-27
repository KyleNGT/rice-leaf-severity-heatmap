import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * ============================================================
 * useAlignmentQueue — Staging Area for Un-Aligned Photos
 * ============================================================
 * A photo picked from the camera or gallery does NOT go straight into a
 * plant's draft. It waits here until the user confirms its crop in
 * ImageAlignmentModal. Keeping it out of the draft entirely — rather than
 * marking it "pending" on a draft image — means aggregateSample.js,
 * canAddSample, and SamplePanel's photo-tile rendering need no changes at
 * all: a photo only ever enters the draft already cropped and already
 * in-flight to the ML pipeline, exactly like today.
 *
 * Object URLs: at most ONE full-size object URL from this queue is ever
 * alive at a time — created for react-easy-crop's `image` prop only for
 * `files[index]`, and revoked the moment `index` (or the file list) changes,
 * via the effect below. This is strictly better than today's memory profile,
 * where every candidate photo gets a URL up front even if later discarded
 * for being over MAX_IMAGES_PER_SAMPLE.
 */
export function useAlignmentQueue() {
  const [queue, setQueue] = useState(null); // { files, index, source, totalCount } | null
  const [currentUrl, setCurrentUrl] = useState(null);
  const queueRef = useRef(null);

  const setQueueBoth = useCallback((next) => {
    queueRef.current = next;
    setQueue(next);
  }, []);

  const currentFile = queue ? queue.files[queue.index] ?? null : null;

  // Exactly one object URL alive at a time, scoped to the current item.
  useEffect(() => {
    if (!currentFile) {
      setCurrentUrl(null);
      return undefined;
    }
    const url = URL.createObjectURL(currentFile);
    setCurrentUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [currentFile]);

  /** Accepts already-capped `files` — capacity is the caller's job, once. */
  const enqueue = useCallback(
    (files, source) => {
      if (files.length === 0) return;
      setQueueBoth({ files, index: 0, source, totalCount: files.length });
    },
    [setQueueBoth]
  );

  /** Drop this photo only; the rest of the batch continues. */
  const skipCurrent = useCallback(() => {
    const current = queueRef.current;
    if (!current) return;
    const nextIndex = current.index + 1;
    if (nextIndex >= current.files.length) {
      setQueueBoth(null);
      return;
    }
    setQueueBoth({ ...current, index: nextIndex });
  }, [setQueueBoth]);

  /** Advance past the just-committed photo, or close the queue if it was the last. */
  const advance = useCallback(() => {
    const current = queueRef.current;
    if (!current) return;
    const nextIndex = current.index + 1;
    setQueueBoth(nextIndex >= current.files.length ? null : { ...current, index: nextIndex });
  }, [setQueueBoth]);

  /** Abandon everything not yet confirmed. Already-committed photos are untouched. */
  const cancelAll = useCallback(() => {
    setQueueBoth(null);
  }, [setQueueBoth]);

  return useMemo(
    () => ({
      queue,
      currentFile,
      currentUrl,
      isAligning: queue !== null,
      isFirstOfBatch: queue ? queue.index === 0 : true,
      enqueue,
      skipCurrent,
      advance,
      cancelAll,
    }),
    [queue, currentFile, currentUrl, enqueue, skipCurrent, advance, cancelAll]
  );
}
