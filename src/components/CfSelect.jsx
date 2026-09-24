/* CfSelect — the office portal's "cf-*" dropdown (button showing the
   current value + chevron, opening a floating rounded menu with a
   checkmark on the active option) ported to React, in place of the
   browser's own native <select> popup. Rules shared with the
   Barcode_Counter repo — its own src/components/CfSelect.jsx does the same
   job there; change the look in one, change it in the other (see the
   .cf-* rules in src/styles/index.css). mjm-ai-system's
   shared/shared_cf_select.js is the same thing again for plain <select>
   elements in that repo.

   Drop-in native-<select> replacement: same id/value/onChange/disabled
   props, <option>/<optgroup> children read the same way a real <select>
   reads them (value falls back to the option's own text when the
   `value` attribute is left off, exactly like the DOM does). onChange is
   called with a { target: { value } } shape so an existing
   `onChange={(e) => setX(e.target.value)}` keeps working unchanged — the
   only edit at each call site is the tag name. */
import { useState, useRef, useEffect, useMemo, Children, isValidElement } from 'react';

function readOption(opt) {
  const hasValue = opt.props.value !== undefined;
  return {
    value: String(hasValue ? opt.props.value : opt.props.children),
    label: opt.props.children,
    disabled: !!opt.props.disabled,
  };
}
function readOptions(children) {
  const out = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === 'optgroup') {
      out.push({ group: child.props.label });
      Children.forEach(child.props.children, (opt) => {
        if (isValidElement(opt) && opt.type === 'option') out.push(readOption(opt));
      });
    } else if (child.type === 'option') {
      out.push(readOption(child));
    }
  });
  return out;
}

export default function CfSelect({ id, value, onChange, disabled, children, ariaLabel, 'aria-label': ariaLabelAttr }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  const items = useMemo(() => readOptions(children), [children]);
  const flatOptions = items.filter((it) => !it.group);
  const currentValue = value === undefined || value === null ? '' : String(value);
  const current = flatOptions.find((o) => o.value === currentValue);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  function pick(opt) {
    if (opt.disabled) return;
    setOpen(false);
    onChange && onChange({ target: { value: opt.value } });
  }

  return (
    <div className="cf-wrap" ref={wrapRef}>
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-label={ariaLabel || ariaLabelAttr}
        className={'cf-btn' + (open ? ' open' : '')}
        onClick={() => !disabled && setOpen((o) => !o)}
      >
        <span className="cf-btn-label">{current ? current.label : (flatOptions.length ? '' : '—')}</span>
        <svg className="cf-chevron" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 7l5 5 5-5" />
        </svg>
      </button>
      {open && (
        <div className="cf-menu">
          {items.length === 0 && <div className="cf-opt-empty">{'—'}</div>}
          {items.map((it, i) =>
            it.group ? (
              <div className="cf-opt-group" key={'g' + i}>{it.group}</div>
            ) : (
              <button
                type="button"
                key={i}
                disabled={it.disabled}
                className={'cf-opt' + (it.value === currentValue ? ' active' : '')}
                onClick={() => pick(it)}
              >
                {it.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
