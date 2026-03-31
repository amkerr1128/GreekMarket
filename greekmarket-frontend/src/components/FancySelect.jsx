import { useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon } from "./icons";
import "../styles/FancySelect.css";

export default function FancySelect({
  options = [],
  value,
  onChange,
  ariaLabel,
  placeholder = "Select",
  className = "",
  disabled = false,
}) {
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);

  const selected = useMemo(
    () => options.find((option) => option.value === value) || null,
    [options, value]
  );

  useEffect(() => {
    function handlePointer(event) {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className={`fancy-select ${open ? "open" : ""} ${disabled ? "disabled" : ""} ${className}`.trim()}
    >
      <button
        type="button"
        className="fancy-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => {
          if (!disabled) setOpen((current) => !current);
        }}
      >
        <span className="fancy-select-value">{selected?.label || placeholder}</span>
        <ChevronDownIcon className="fancy-select-chevron" />
      </button>

      {open ? (
        <div className="fancy-select-menu card" role="listbox" aria-label={ariaLabel}>
          {options.map((option) => {
            const isActive = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                className={`fancy-select-option ${isActive ? "active" : ""}`}
                onClick={() => {
                  onChange?.(option.value);
                  setOpen(false);
                }}
              >
                <span className="fancy-select-option-copy">
                  <span className="fancy-select-option-label">{option.label}</span>
                  {option.meta ? <span className="fancy-select-option-meta">{option.meta}</span> : null}
                </span>
                {isActive ? <CheckIcon className="fancy-select-check" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
