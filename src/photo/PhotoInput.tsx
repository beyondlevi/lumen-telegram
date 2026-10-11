import {useEffect, useImperativeHandle, useRef, type ChangeEvent, type Ref} from 'react';

export type PhotoInputHandle = {
  /** Opens the camera (Lumen's capture screen; a file picker in a desktop browser). */
  open(): void;
};

/**
 * The hidden file input behind "Photo" and "Retake". `onPhoto` gets the file
 * the capture hands over; `onCancel` runs when the wearer leaves the capture
 * screen without a photo.
 */
export function PhotoInput({
  ref,
  onPhoto,
  onCancel,
}: {
  ref?: Ref<PhotoInputHandle>;
  onPhoto: (file: File) => void;
  onCancel?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => ({
    open() {
      const input = inputRef.current;
      if (input != null) {
        // The same photo can be chosen again after a Cancel.
        input.value = '';
        input.click();
      }
    },
  }));
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  useEffect(() => {
    const input = inputRef.current;
    const cancelled = () => onCancelRef.current?.();
    input?.addEventListener('cancel', cancelled);
    return () => input?.removeEventListener('cancel', cancelled);
  }, []);
  const changed = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (file != null) {
      onPhoto(file);
    }
  };
  return (
    <input
      ref={inputRef}
      className="photo-input"
      type="file"
      accept="image/*"
      capture="environment"
      tabIndex={-1}
      aria-hidden="true"
      onChange={changed}
    />
  );
}
