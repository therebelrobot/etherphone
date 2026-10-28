/**
 * Handing a file to the player.
 *
 * There is no upload and no server anywhere in this instrument, so "export"
 * means exactly this: the page builds a blob and asks the browser to save it.
 * Kept in one place because both the take file and (later) a rendered
 * performance from #12 will want it.
 */

/** Opens the browser's save dialog for `blob`, under `filename`. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";

  document.body.append(anchor);
  anchor.click();
  anchor.remove();

  // The download has to be under way before the URL goes, and browsers differ
  // over exactly when that is, so it is released on a timer rather than
  // immediately. One second is far longer than it takes to start.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
