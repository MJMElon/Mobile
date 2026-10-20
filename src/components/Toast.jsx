import { useCallback, useRef, useState } from 'react';
import Icon from './Icon.jsx';

// Every call site still writes its own leading emoji -- showToast('❌ ...'),
// showToast('⚠️ ...') and so on -- because that is what actually says
// success/error/warning at a glance, not the fixed ✅ the host used to draw
// in front of every message including its own failures. Reusing that text
// is simpler than threading a `type` through all 40-odd call sites: this
// map turns the leading glyph into the matching vector icon and drops it
// from what is drawn as text, so nothing else in the app has to change.
// Keyed on the BASE codepoint only -- a variation selector (U+FE0F) some of
// these carry is a SUFFIX of the same string, so matching the base alone
// already matches both spellings, and the strip below removes it either way.
const EMOJI_ICON = {
  '✅': 'checkCircle', '✔': 'checkCircle', '✓': 'checkCircle',
  '❌': 'errorCircle', '⛔': 'blocked',
  '⚠': 'warning', '📴': 'offline', '🔒': 'lock', '🔓': 'unlock',
  '📷': 'camera', '🔖': 'tag', '🔍': 'search', '🤖': 'sparkles',
  '⚡': 'bolt', '💾': 'save', '📭': 'inboxEmpty', '✨': 'sparkles',
  '👷': 'worker', '☁': 'cloud', '🌫': 'fog', '📃': 'document',
  '✏': 'pen', '✦': 'sparkles', '🖨': 'printer', '📦': 'box',
  '📥': 'download', '↩': 'undo', '☀': 'sun', '🌤': 'sunCloud',
  '⛅': 'sunCloud', '⛈': 'storm', '🌱': 'seedling', '💧': 'drop',
  '📍': 'pin', '⬇': 'download', '🔄': 'refresh', '🧾': 'receipt',
  '📝': 'pencilNote', '🌧': 'cloud', '🌦': 'sunCloud',
};

function splitLeadingIcon(text) {
  const t = String(text || '');
  for (const glyph of Object.keys(EMOJI_ICON)) {
    if (t.startsWith(glyph)) {
      return { icon: EMOJI_ICON[glyph], rest: t.slice(glyph.length).replace(/^️?\s*/, '') };
    }
  }
  return { icon: 'checkCircle', rest: t };
}

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
    () => {
      const { icon, rest } = splitLeadingIcon(msg);
      return (
        <div className={`toast ${show ? 'show' : ''}`}>
          <Icon name={icon} className="w-4 h-4 shrink-0" /> <span>{rest}</span>
        </div>
      );
    },
    [show, msg],
  );

  return { ToastHost, showToast };
}
