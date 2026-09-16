export function downloadTextFile(
  fileName: string,
  text: string,
  mime = "text/csv;charset=utf-8",
): void {
  const payload = mime.startsWith("text/csv") ? `\uFEFF${text}` : text;
  const blob = new Blob([payload], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
