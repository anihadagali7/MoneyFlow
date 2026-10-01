/**
 * Earlier turns as question/answer pairs. History comes from the browser, so a question that
 * failed (no answer) or a cut-off leading answer is dropped rather than sent as two turns
 * from the same side.
 */
export function answeredTurns<T extends { role: string }>(history: T[]): T[] {
  const turns: T[] = [];
  for (let i = 0; i < history.length; i++) {
    if (history[i].role === "user" && history[i + 1]?.role === "assistant") {
      turns.push(history[i], history[i + 1]);
      i++;
    }
  }
  return turns;
}
