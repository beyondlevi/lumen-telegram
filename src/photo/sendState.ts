/** History state of the entry that shows the photo just taken, over the conversation. */
export function isPhotoSendState(state: unknown): boolean {
  return state != null && typeof state === 'object' && 'photoSend' in state && state.photoSend === true;
}
