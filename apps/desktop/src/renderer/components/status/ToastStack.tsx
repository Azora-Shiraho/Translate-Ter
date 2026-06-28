import React from 'react';
import type { ToastMessage } from '../../app/types';

type ToastStackProps = {
  toasts: ToastMessage[];
  copyTitle: string;
  onCopyError: (toast: ToastMessage) => void;
};

export function ToastStack(props: ToastStackProps): JSX.Element | null {
  if (props.toasts.length === 0) return null;
  return (
    <div className="toastStack" aria-live="polite" aria-atomic="false">
      {[...props.toasts].reverse().map((toast) =>
        toast.tone === 'error' ? (
          <button
            className={`toastCard copyable ${toast.tone}${toast.exiting ? ' exiting' : ''}`}
            key={toast.id}
            title={props.copyTitle}
            type="button"
            onClick={() => props.onCopyError(toast)}
          >
            <span className="toastMark" />
            <p>{toast.message}</p>
          </button>
        ) : (
          <div className={`toastCard ${toast.tone}${toast.exiting ? ' exiting' : ''}`} key={toast.id}>
            <span className="toastMark" />
            <p>{toast.message}</p>
          </div>
        )
      )}
    </div>
  );
}
