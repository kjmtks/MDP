// Listen to a term or a reading with the narrator the app is set to (window.mdpTts —
// the voice of the auto-play), WITHOUT the glossary: to hear the text itself — how a
// term is read as written, and how its reading sounds. `lang` = the lines the glossary
// is for (a term like "SHAP" sounds as it would in a line of that language).
export function speakPlain(text: string, lang?: string): void {
  const tts = (window as unknown as { mdpTts?: { speak: (t: string, o?: Record<string, unknown>) => unknown } }).mdpTts;
  const t = String(text || '').trim();
  if (!tts || !t) return;
  try { void tts.speak(t, { glossary: false, ...(lang ? { lang } : {}) }); } catch { /* the narrator cannot speak now */ }
}
