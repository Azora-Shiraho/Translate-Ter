import React from 'react';

type BottomBubbleProps = {
  message?: string;
};

export function BottomBubble(props: BottomBubbleProps): JSX.Element | null {
  if (!props.message) return null;
  return <div className="bottomBubble">{props.message}</div>;
}
