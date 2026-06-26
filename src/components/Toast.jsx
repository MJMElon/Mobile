import { useCallback, useRef, useState } from 'react';

// Reusable toast. Usage:
//   const { ToastHost, showToast } = useToast();
//   ...
//   return (<>{ ... } <ToastHost /></>);
//   showToast('Saved!');
export function useToast() {
  const [msg, setMsg] = useState('');
  const [show, setShow] = useState(false);
  const timer = useRef(null);

  const showToast = useCallback((text) => {
    setMsg(text);
    setShow(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setShow(false), 3500);
  }, []);

  const ToastHost = useCallback(
    () => (
      <div className={`toast ${show ? 'show' : ''}`}>
        ✅ <span>{msg}</span>
      </div>
    ),
    [show, msg],
  );

  return { ToastHost, showToast };
}
