// Per-chat "read up to" timestamps, kept in localStorage so a chat opened on
// the glasses stays un-highlighted even if the server's unreadCount lags.

const READ_MARKS_KEY = 'lumen-telegram.read-marks';
const READ_MARKS_MAX = 200;

export type ReadMarks = Record<string, number>;

export function loadReadMarks(): ReadMarks {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(READ_MARKS_KEY) ?? '{}');
    if (parsed == null || typeof parsed !== 'object') {
      return {};
    }
    const marks: ReadMarks = {};
    for (const [chatId, value] of Object.entries(parsed)) {
      if (typeof value === 'number') {
        marks[chatId] = value;
      }
    }
    return marks;
  } catch {
    return {};
  }
}

export function saveReadMarks(marks: ReadMarks): void {
  const entries = Object.entries(marks)
    .sort((a, b) => b[1] - a[1])
    .slice(0, READ_MARKS_MAX);
  try {
    localStorage.setItem(READ_MARKS_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Read marks are a convenience; losing them only re-highlights chats.
  }
}
