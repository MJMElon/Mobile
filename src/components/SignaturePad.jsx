import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

// Canvas signature pad. Exposes via ref:
//   hasSignature() -> bool
//   toDataURL()    -> png data url
//   clear()        -> wipe
// Calls onSignedAt(Date) when a stroke ends.
const SignaturePad = forwardRef(function SignaturePad(
  { height = 180, hint = 'Sign here', onSignedAt },
  ref,
) {
  const canvasRef = useRef(null);
  const state = useRef({ drawing: false, hasSig: false });
  const [showHint, setShowHint] = useState(true);

  useImperativeHandle(ref, () => ({
    hasSignature: () => state.current.hasSig,
    toDataURL: () => canvasRef.current?.toDataURL('image/png'),
    clear: () => {
      const c = canvasRef.current;
      if (!c) return;
      c.getContext('2d').clearRect(0, 0, c.width, c.height);
      state.current.hasSig = false;
      setShowHint(true);
    },
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    function resize() {
      // Preserve nothing on resize — pads are short-lived inside modals.
      canvas.width = canvas.offsetWidth || canvas.parentElement.offsetWidth || 400;
      canvas.height = height;
      ctx.strokeStyle = '#064e3b';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    }
    resize();

    function getPos(e) {
      const r = canvas.getBoundingClientRect();
      const s = e.touches ? e.touches[0] : e;
      return {
        x: (s.clientX - r.left) * (canvas.width / r.width),
        y: (s.clientY - r.top) * (canvas.height / r.height),
      };
    }
    function start(e) {
      e.preventDefault();
      state.current.drawing = true;
      state.current.hasSig = true;
      setShowHint(false);
      const p = getPos(e);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    }
    function move(e) {
      if (!state.current.drawing) return;
      e.preventDefault();
      const p = getPos(e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    function end() {
      if (!state.current.drawing) return;
      state.current.drawing = false;
      if (onSignedAt) onSignedAt(new Date());
    }

    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    canvas.addEventListener('mouseup', end);
    canvas.addEventListener('mouseleave', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end);
    return () => {
      canvas.removeEventListener('mousedown', start);
      canvas.removeEventListener('mousemove', move);
      canvas.removeEventListener('mouseup', end);
      canvas.removeEventListener('mouseleave', end);
      canvas.removeEventListener('touchstart', start);
      canvas.removeEventListener('touchmove', move);
      canvas.removeEventListener('touchend', end);
    };
  }, [height, onSignedAt]);

  return (
    <div className="sig-wrap" style={{ cursor: 'crosshair' }}>
      <canvas ref={canvasRef} height={height} style={{ display: 'block', width: '100%' }} />
      {showHint && <div className="sig-hint">{hint}</div>}
    </div>
  );
});

export default SignaturePad;
